# RCA：通话单通（只有一方能听到对方声音）

- 状态：已定位并修复（代码已改，E2E 双向验证通过）
- 关联缺陷：外部报告「phone calls have one-way audio (only one side can hear)」——缺陷为用户实测报告；LiWeny16/LetShare 仓库 issues 中无对应条目（仓库唯一 issue 为已关闭的 PR #1，PRO 中继鉴权，与本缺陷无关）。本仓库内的缺陷跟踪与处置记录见 `Harness/tasks/task-fix-oneway-call-audio/`。
- 验证脚本：`tests/e2e/diag-loud.mts`（AC-001 门禁）、`tests/e2e/diag-sink.mts`（决定性实验）、`tests/e2e/diag-reanchor.mts`（排除项）
- 涉及代码：`src/pages/share.tsx`、`src/app/libs/call/callSession.ts`、`src/app/libs/call/callManager.ts`

---

## 1. 现象与角色不对称

P2P 通话中，**主叫（caller）能听到被叫（callee），被叫几乎总是听不到主叫**；把主被叫互换，无声侧跟随"被叫"角色移动 —— 说明问题在**接听路径**，与设备、TURN、SDP 协商无关。

在弱 headless 环境下可 100% 确定性复现：被叫侧 WebRTC inbound 统计呈现特征性签名（见 §3）。

---

## 2. 根因（两个叠加缺陷）

### RC-1（音频解码根因，决定性）：被叫的远端音频轨在 ontrack 时没有任何 sink

缺陷链：

1. **早到 offer 缓冲**使被叫的 `ontrack` 在 `acceptCall()` 的 `await` 期间就触发。
   `callSession.ts` 对 accept 前收到的 offer 做缓冲（`src/app/libs/call/callSession.ts`，早到 offer/ICE 缓冲逻辑，`ensurePeer` 规范顺序 `SRD(offer) → addTrack → flush`），`setRemoteDescription(offer)` 一返回，`ontrack` 同步触发。
2. 而 `src/pages/share.tsx` 的 `acceptIncoming()` 旧逻辑是：先 `await manager.acceptCall(...)`，**之后**才 `setActiveCall(...)`。回调 `onRemoteStream`（share.tsx 旧 L187）以 `activeCallRef.current` 判空 —— 在 `await` 期间它是 `null`，远端流被**静默丢弃**。
3. 旧代码里 `callSession.ts` 的 `bindRemoteStream()` 只在 `remoteAudioEl` 非空时才绑 sink，而 `attachRemoteAudio()` 从未被任何 UI 代码调用 —— 被叫的远端音轨**在整个会话期间没有任何 sink**。
4. Chromium 只有在音频轨挂上 sink（`HTMLAudioElement.srcObject` / `setSinkId` 之后的渲染消费）后才会启动 NetEq 解码渲染循环；没有 sink，抖动缓冲只进不出，填满后（~200 包 / 4s）**所有包在进入 jitter buffer 之前就被丢弃**。

**主叫为什么正常**：主叫的 `ontrack` 要等 answer 往返一圈之后才触发，此时 `setActiveCall`（share.tsx 旧 L269）早已提交，`onRemoteStream` 正常写入状态，CallBar 挂上 `<audio>` sink —— 所以总是"主叫听得见、被叫听不见"。

### RC-2（UI 状态根因，被 RC-1 修复掩盖）：同批次事件用 stale ref 互相覆盖

即使把 ref 种子提前（修复第一步），被叫仍有第二个坑：

- `callSession.ts` 的 `ontrack` 处理器里，`bindRemoteStream → events.onRemoteStream(...)` 之后**立即** `setState("active") → events.onCallState(...)`。两个回调在**同一个 React 批次**内背靠背执行。
- 旧回调写法都是 `const cur = activeCallRef.current; setActiveCall({ ...cur, X })` —— 两者读到的是**同一个尚未提交的旧 ref**，后一次 `setActiveCall` 把前一次写入的 `remoteStream` **整体覆盖丢失**。
- 结果：`activeCall.remoteStream` 恒为 null，CallBar 的 effect（`CallBar.tsx:173-198`，依赖 `[remoteStream, open]`）永远等不到流，UI 音频元素不绑定。
- 主叫不受影响：它的 `onRemoteStream` 晚于最后一个 `onCallState` 数秒，中间有完整 commit。

修复前的运行时探针（`console.log("[Call] onRemoteStream evt ...")`）证实：被叫侧事件触发、guard 通过、`setActiveCall` 确实执行 —— 但 CallBar 依旧只看到 `null`，即"更新被执行又被覆盖"。

---

## 3. 证据链（E2E 实测）

### 3.1 修复前 AC-001（`diag-loud.mts`，441Hz 响亮 WAV + fake 设备）

被叫侧 inbound 特征签名：

| 指标 | 被叫（卡死侧） | 主叫（正常侧） |
|---|---|---|
| `totalSamplesReceived` (smpl) | **0** | ~667k（持续增长） |
| `packetsDiscarded` (disc) | 600→1000→1400（**精确等于收包速率**） | 0 |
| `jitterBufferDelay` (jb) | 0 | ~19800 |
| `jitterBufferEmittedCount` (emit) | -1（字段=0） | ~667k |
| `jitterBufferFlushes` (flush) | **字段缺失**（NetEq 从未启动） | 有值 |

disc 精确等于收包速率 + flush 字段缺失 = **包在 jitter buffer 之前被丢**，这是"无 sink → 无渲染拉动 → 解码不启动"的 Chromium 特征签名，直接排除丢包/网络/解码器问题。

### 3.2 决定性实验（`diag-sink.mts`）

原型补丁 `RTCPeerConnection.prototype.setRemoteDescription`：SRD 之后给**每个 audio receiver** 立即挂一个 `<audio>` sink。结果：**两种角色下被叫侧全部翻转** `smpl0/disc600 → smpl≈670k/disc0/emit≈667k`，且**静音 sink（`muted=true`）同样生效**（生产可用：避免与 CallBar 元件双重出声）。Sink 假设因果闭环。

### 3.3 排除项（均有实验）

| 假设 | 结论 | 证据 |
|---|---|---|
| SRD/addTrack 顺序（方向一修复） | 真实潜在 bug，但**不是**本单通主因 | 修复后 AC-001 仍失败 |
| M149 版本 NetEq flush 回归 | 排除 | 卡死侧无 flush 字段（有 flush 行为才有该字段） |
| 重协商 / replaceTrack 可恢复 | 排除 | `diag-reanchor.mts`：`__lsFreshen`/`__lsRenegotiate` 均不解卡 |
| SDP/编解码/SSRC/ICE/TURN 不对称 | 排除 | 双向 SDP 对称、RTCP 双向流动、byes/pt/mime 完全一致 |

### 3.4 修复后 AC-001（最终验证，`diag-loud.mts`）

四个方向（E1 主叫 alice / E2 主叫 bob × 各自的对端）全部通过：

- 双侧日志：`[Call] audio stream bound to session sink (muted)` → `[CallBar] remoteStream effect stream has audio=1` → `[CallBar] audio element srcObject set`
- 双侧统计：`smpl≈669k~670k / disc0 / emit≈668k~669k / jb≈19900` —— **全双工解码，零丢弃**
- 单测：`npx tsc --noEmit` 通过；`node scripts/run-tests.cjs` 322/323（唯一失败为改动前即存在的 `tests/publicRelayAuthSync.test.ts:43`，与本缺陷无关）；callManager 套件 21/21。

---

## 4. 修复内容

### Fix A — `src/pages/share.tsx`（事件→状态链路）

1. **同步种子**：`startCall()`（~L238）与 `acceptIncoming()`（~L290）在 `await manager.*` **之前**构造完整 call 对象并同步写入 `setActiveCall(call)` + `activeCallRef.current = call`，保证 await 期间到达的 `onRemoteStream` 不再被 null guard 丢弃。
2. **函数式更新**：CallManager 初始化 effect 的五个回调（`onCallState` L181、`onRemoteStream` L186、`onLocalStream`、`onTransportChange`、`onCallEnded`，L207-216）全部改为 `setActiveCall((prev) => prev && prev.peerId === peerId ? { ...prev, X } : prev)` —— React 的 updater 链式接收最新排队 state，同批次事件不再互相覆盖；`onRemoteStream` 内保留"缺失 kind 轨道并入现有流、引用稳定不重挂"的防御逻辑。

### Fix B — `src/app/libs/call/callSession.ts`（保底音频 sink）

- 新增 `ensureRemoteAudioSink()`（~L201-216）：创建隐藏 `<audio>`（`muted=true`、`autoplay`、不参与布局）作为会话自有的远端音频 sink；DOM 缺失时 no-op。
- `bindRemoteStream()` 的 audio 分支自动调用之 —— **无论 UI 是否绑定，远端音轨永远有 sink**，NetEq 渲染循环必然启动。
- `hangup()` 中清理自有 sink 元素（~L557+），避免泄漏。

**设计说明**：CallBar 的可见 `<audio>` 负责实际出声（用户可感知音量控制）；会话 sink 为 muted，仅用于"拉动"解码管线 —— 两者并存不会双重出声。这使得解码正确性与 UI 状态正确性**解耦**：即使未来再出现状态类 bug，音频也不再单通。

---

## 5. 遗留与建议

- **AC-002（生产人工复测）**：在真实设备（有物理音频输出）+ 公网 TURN 下双机互打，确认双方向出声。弱 headless E2E 已证明与生产同机制（同为 Chromium 渲染管线），但"人耳听到"需人工验收。
- **回归防护**：`tests/callManager.test.ts` 已含两条方向一回归用例（规范顺序、wantVideo）；建议后续把"被叫 UI 必须收到 remoteStream"补成 E2E 断言（`diag-loud` 的 CallBar 日志已可程序化断言）。
- **教训**：React 事件回调内依赖 `ref.current` 派生 state 时，同批次多个事件会用 stale ref 互相覆盖；一切"对现有 state 增量合并"的 setState 都应使用函数式更新。
