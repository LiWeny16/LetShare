# task-fix-oneway-call-audio - PLAN

紧凑任务记录：只留续修、复审、验证所需的事实。链接到文件/命令而非粘贴日志或子代理转录。

> Task ID: task-fix-oneway-call-audio

## Goal

- Outcome: 修复"offerer(发起方)的音频永远不被 callee(接听方)解码"的单通 bug。目标：双向都能被对端解码出声。
- Non-goals: 不引入新传输模式；不动视频路径；不作超出根因范围的架构改动。

## 根因画像（最终版，实证收敛，2026-09-01）

**RC-1（音频解码根因，决定性）**：被叫的远端音频轨在 ontrack 时无任何 sink。
- 早到 offer 缓冲使被叫 `ontrack` 在 `acceptCall()` 的 `await` 期间触发；旧 `acceptIncoming()` 在 await 后才 `setActiveCall`，`onRemoteStream` 以 `activeCallRef.current` 判空 → 流被静默丢弃。
- 旧 `callSession.ts bindRemoteStream` 仅在 `remoteAudioEl` 非空时绑 sink，而 `attachRemoteAudio` 从未被调用 → 被叫远端音轨全程无 sink。
- Chromium 无 sink 不启动 NetEq 渲染循环 → 抖动缓冲填满(~200包/4s)后包在进 jitter buffer 前整路丢弃。签名：`smpl0/disc=收包速率/jb0/emit0/flush字段缺失`。
- 主叫 ontrack 晚于 setActiveCall（answer 往返后）→ 永远正常 ⇒ "caller 听 callee、callee 听不到" 的确定性角色不对称。

**RC-2（UI 状态根因，被 Fix A 第一步暴露）**：被叫 `onRemoteStream` 与 `onCallState("active")` 在同一 React 批次背靠背触发（ontrack 处理器内连续发射），旧回调读同一 stale `activeCallRef.current` 后者覆盖前者 → `activeCall.remoteStream` 恒 null，CallBar 永不绑定。运行时探针证实 `setActiveCall` 执行了但状态最终无流。

决定性实验（tests/e2e/diag-sink.mts）：原型补丁 SRD 后立即给每个 audio receiver 挂 `<audio>` sink（含 muted=true）→ 两种角色被叫全部翻转 `smpl0/disc600 → smpl≈670k/disc0/emit≈667k`。Sink 因果闭环；muted sink 生产可用（不与 CallBar 双重出声）。

排除项（均有硬数据，历史记录保留于下方原画像）：
1. 网络/代理/TURN —— 排除：loopback、connectionState=connected 已证 ICE 双向（RFC 8445 §6）。
2. DTX/空包/麦克风弱 —— 排除：全速率、72B/包真实载荷、同源假声反向正常解出。
3. 编解码/PT/SSRC/方向错配 —— 排除：SDP 全对称（diag-p2p-sdp/diag-loud dump）。
4. SRD/addTrack 顺序（方向一）—— 真实潜在 bug 但非本单通主因：修复后 AC-001 仍 FAIL。
5. M149 NetEq flush 回归 —— 排除：卡死侧无 flush 字段。
6. 重协商/replaceTrack 恢复 —— 排除：diag-reanchor.mts 两 lever 均不解卡。

## Decisions

- **Fix A（share.tsx，实施）**：① `startCall`/`acceptIncoming` 在 `await manager.*` 前同步构造 call 对象并种 `setActiveCall(call)+activeCallRef.current=call`；② CallManager 初始化 effect 五个回调（onCallState/onRemoteStream/onLocalStream/onTransportChange/onCallEnded）全部改函数式 `setActiveCall((prev)=>...)`，同批次事件链式合并不再覆盖。
- **Fix B（callSession.ts，实施）**：新增 `ensureRemoteAudioSink()`（隐藏 muted `<audio>`，DOM 缺失 no-op），`bindRemoteStream` audio 分支必调 → 远端音轨永远有 sink，NetEq 必启动；`hangup` 清理。解码正确性与 UI 状态解耦，UI 绑定 CallBar 可见元件负责实际出声。
- 方向一（callSession.ts 规范顺序 SRD(offer)→flushPendingIce→addTrack + callManager.ts:244 wantVideo `!==` 修正）：保留 —— 真实潜在 bug + 2 条回归用例，但被证伪为本单通主因。
- 方向二（重建 PC）、方向三（生产机制确诊）：方向二不再需要；方向三转 AC-002 人工复测。
- 交付物：`documents/RCA-oneway-call-audio.md`（根因分析 + 证据链 + 代码引用）。

## Acceptance

- AC-001（E2E/回归）：**已通过（2026-09-01）** —— diag-loud 最终验证：E1/E2 双场景四方向全部 `smpl≈669k~670k/disc0/emit≈668k~669k/jb≈19900`；双侧日志含 `audio stream bound to session sink (muted)` + CallBar `stream has audio=1` + `srcObject set`。
- AC-002（生产合理性）：**待人工复测** —— 真实设备物理音频输出 + 公网 TURN 下双机互打双方向出声（环境无法自动验收，见 PROGRESS.md 风险）。

证据要求（触发时）：E2E 用 getStats 探针 + SDP dump（tests/e2e/diag-loud.mts 已具备）；UI 用真实浏览器证据。

## Scope

Allowed write set：
- src/app/libs/call/callManager.ts
- src/app/libs/call/callSession.ts
- tests/e2e/*（探针复用/增补）
- 本 task 胶囊 Harness/tasks/task-fix-oneway-call-audio/*

Forbidden：
- 真值文件（PRD/ACs/UI-API 契约/测试计划/验证报告）除非记录 Change Request
- 不重建 docs/、不 bump 版本(除非用户要求走发布流程)

## Context

- Loaded: CLAUDE.md、callManager.ts、callSession.ts、CallBar.tsx、README#Deployment Notes、memory/sw-cache-version-bump.md。
- Assumptions: 生产与 weak-headless 复现同机制（待 AC-002 确认）；根因在编排时序而非裸 WebRTC。

## Agents

调查期派了 4 个读取/查询子代理 + 2 个 GitHub 检索子代理；均只读，不写代码。结论已并入上文根因画像。修复实施由主代理直接做（小而局部）。

| Role | Read / Write Set | Result |
|------|------------------|--------|
| docs-researcher x2 / researcher x2 | 只读(官方文档/规范) | 判定网络/DTX/协商语义，排除多项 |
| general-purpose x2 | 只读(GitHub/同类项目) | livekit#4599 类接收端丢弃、DTX header-only 等对照 |

## Verification

- [ ] AC-001：app E2E 双方向 inbound 采样>0、disc≈0（复用 diag-loud 探针）
- [ ] AC-002：响亮+TURN 公网复测
- [ ] 单元/类型检查通过（pnpm build / tsc）

## Risks

- 若方向一仍 disc>0 → 根因更深（Chromium 接收端对特定流的分流），需方向二(重建连接)或抓包确认真实 PT/扩展头。
- weak-headless 与生产非同机制时，AC-002 可能推翻方向一，需优先生产确诊。
