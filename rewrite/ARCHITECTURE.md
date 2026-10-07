# 目标架构与不变量契约（rewrite/core-v2）

> 本文件是**唯一裁决依据**。任何 subagent 的产出若与本文件冲突，一律打回。

## 0. 设计公理

| 编号 | 公理 | 消灭的历史事故 |
|---|---|---|
| A1 | **单一属主**：每个不变量恰好一个写者，其余皆为订阅者 | B2 双声 / B1 静音（同一 bug 两种症状）|
| A2 | **状态机化**：生命周期必须显式；跨模块对齐只允许走状态转移，禁止 ad-hoc guard | A1/A2 会议被误销毁 |
| A3 | **声明式调和**：恢复不依赖"收到某个事件"，只依赖重声明期望状态 | A5 恢复失败 |
| A4 | **重试必然收敛**：只有两种合法出口 —— 已排下一次，或终止态 + 原因 | A3 静默死锁 4 分 25 秒 |
| A5 | **可观测一流**：状态跃迁必发事件、必带 reason、必带 sessionId | 全部事故靠猜 |
| A6 | **机制与策略分离**：call 与 meeting 共用机制，只差策略 | C2 同一课只学一遍 |

---

## 1. 不变量属主表（新增写者必须先在表内登记）

| 不变量 | 唯一写者 | 违反的后果（已发生）|
|---|---|---|
| 远端音频有且仅有一个发声者 | `core/audio/RemoteAudioHost` | B1 永久静音 / B2 双重声音 |
| relay 中续期必须重建 allocation | `core/turn/TurnLease` | C2 relay 场景 10 分钟必断 |
| 重试必有下一次调度或终止态 | `core/transport/RetrySupervisor` | A3 4 分 25 秒零重连 |
| 会议号生命周期 ≠ 房间占用 | `internal/meeting/lifecycle` | A1 重连回来 404 |
| 恢复不依赖事件到达 | `core/transport/TransportClient` + `core/media/MediaSession` | A5 ICE restart 被服务端 400 挡死 |
| 每次跃迁有 Info + reason | `internal/observ` / `diagnostics` | 无法定位任何断连 |
| 每个远端成员按 trackId 唯一入列 | `core/media/MediaSession` | 重复瓦片 / 重复音频 |
| **会话代次：旧异步结果不得覆盖新连接** | `core/transport/SessionEpoch` + `ConnectionSlot` | 旧 socket 顶掉新连接 —— 症状与"半开永不重连"**同源**（V2 实现）|
| **服务端连接存活（半开探测）** | `core/transport/ServerLiveness` + `LivenessMonitor` | NAT 重绑定后客户端**永远不重连**（V2 实现）|
| **后台省流豁免判定** | `core/transport/BackgroundPolicy` | F15：直写磁盘挂起期间省流被永久解除（V2 实现）|

---

## 2. 客户端目标结构

```
src/core/transport/
  TransportClient.ts      WS 连接/心跳/编解码 —— 零领域知识
  ConnectionState.ts      单一状态机；跃迁必发事件（成功与失败都发）
  RetrySupervisor.ts      唯一重试调度器（A4 的机械保证）
src/core/turn/
  TurnLease.ts            拉取/续期/relay 中强制 rebuild allocation
src/core/media/
  MediaSession.ts         接口：publish/subscribe/tracks/restartIce/dispose
  PublishPeer.ts          发布 PC（call 与 meeting 共用）
  SubscribePeer.ts        单成员订阅 PC（共用）
  IceManager.ts           候选策略 / restartIce / selected-pair 上报
  RecoveryPolicy.ts       有界重试 + 终止原因
src/core/audio/
  RemoteAudioHost.ts      唯一播放权威 + 存活看门狗 + 自动回退
src/core/observ/
  SessionTrace.ts         sessionId 贯穿 + 结构化事件
src/features/call/        只放策略（1:1、铃音、UI 状态）
src/features/meeting/     只放领域（成员/白板/聊天/纪要）
src/features/file/        保留现状（需求不同，不在本次重写范围）
```

**删除目标**：`colabLib.ts`(4713) 收敛为 `TransportClient` + 各 feature 适配层；`share.tsx`(2827) 按 feature 拆分。

### 依赖方向（强制）

```
features/*  →  core/*        ✅
core/a      →  core/b        ✅（单向，见下）
core/*      →  features/*    ❌ 禁止
features/a  →  features/b    ❌ 禁止（跨 feature 只能经 core 的中介）
```

`core` 内部允许的单向依赖：
```
observ ← transport ← turn
                 ↑
               media ← audio
```

---

## 3. 服务端目标结构

```
internal/transport/   WS 接入 + 连接生命周期（跃迁必发事件）
internal/meeting/     ← 唯一会议属主
  lifecycle.go        Reserved → Live → Grace → Ended；唯一 End(reason)
  registry.go         会议号 + 成员 + resumeToken（接口化，可换 Redis）
  policy.go           宽限/TTL/容量/房主转移 —— 策略表，不是分支
internal/sfu/         保留；补 selected-pair、周期 RTP 采样、状态 Info 日志
internal/turn/        保留；补 allocation 生命周期日志
internal/observ/      sessionId 贯穿 + 结构化事件总线
```

**最关键的一次解耦**：会议号（reservation）生命周期与房间占用**彻底分离**。会议号有自己的 TTL / 归属 / 结束条件，与"此刻有没有人在里面"无关。这一处消灭整类"重连回来 404"。

---

## 4. 关键接口草案（可作为实现的起点，但不得偏离语义）

### 4.1 连接状态机 —— 成功与失败**都**必须发事件

```ts
export type ConnectionPhase =
  | { k: "idle" }
  | { k: "connecting"; attempt: number }
  | { k: "ready"; since: number; sessionId: string }
  | { k: "degraded"; since: number; lastError: string }
  | { k: "reconnecting"; attempt: number; nextAttemptAt: number; reason: string }
  | { k: "terminal"; reason: "user-left" | "auth-rejected" | "unsupported" | "attempts-exhausted" };

export interface ConnectionStatePort {
  readonly phase: ConnectionPhase;
  /** 每一次跃迁都必须调用；含失败方向。订阅者不得依赖"只有成功才有信号"。 */
  onTransition(cb: (from: ConnectionPhase, to: ConnectionPhase) => void): () => void;
}
```

### 4.2 重试调度器 —— 唯一的重试入口

```ts
export interface RetryPolicy { baseMs: number; capMs: number; jitterRatio: number; maxAttempts: number | null }

export type RetryOutcome =
  | { kind: "scheduled"; nextAttemptAt: number; attempt: number }
  | { kind: "terminal"; reason: string };

export interface RetrySupervisor {
  /** 唯一允许的重试调度入口。任何模块不得自行 setTimeout 重试。 */
  schedule(key: string, task: () => Promise<void>, policy: RetryPolicy): RetryOutcome;
  /** 放弃时必须产生终止态事件，不得静默 return。 */
  cancel(key: string, reason: string): void;
}
```

### 4.3 TURN 租约

```ts
export interface TurnLease {
  /** 返回当前可用凭据；临近过期时内部续期。 */
  current(): Promise<TurnCredentials>;
  /** 订阅续期事件；relay 中的会话必须在续期后 restartIce（这是 A6 的关键点）。 */
  onRenewed(cb: (creds: TurnCredentials) => void): () => void;
  readonly isRelayed: boolean;
}
```

### 4.4 媒体会话（call 与 meeting 共用机制）

```ts
export interface MediaSession {
  publish(tracks: TrackSet, opts: PublishOptions): Promise<void>;
  subscribe(peerId: PeerId): Promise<void>;
  unsubscribe(peerId: PeerId): void;
  readonly remoteTracks: ReadonlyMap<PeerId, readonly RemoteTrack[]>;
  /** reason 必填 —— 强迫调用方说明为什么重启，并写入事件流。 */
  restartIce(reason: IceRestartReason): Promise<void>;
  readonly diagnostics: MediaDiagnostics;
  dispose(): Promise<void>;
}
```

### 4.5 远端音频播放权威

```ts
export interface RemoteAudioHost {
  /** 唯一允许"决定谁发声"的入口。元素与管线互斥（C-09），且 `stream !== null` 时裁决永不为 `none`（C-08）。 */
  setStream(stream: MediaStream | null): void;
  setPrefs(prefs: { volume: number; clarity: boolean; widen: boolean; sinkId?: string }): void;
  /** UI 注入发声元素（**本接口为 V3 实现新增**）：保留 UI 的 DOM 位置与生命周期，
   *  否则 `tests/e2e/diag-*.mts` 用 `document.querySelector("audio")` 会测到静音 sink（假阴性）。
   *  注入后**写权仍 100% 在 host** —— UI 只传引用，不得自行写 `muted/volume/srcObject/play()`。 */
  bindElement(el: HTMLAudioElement): void;
  readonly state: {
    audibleVia: "pipeline" | "element" | "none";
    ctxState: AudioContextState | "n/a";
    lastFallbackAt: number | null;
    /** 发声被拒且导致没有任何通路真的在响（C-12b）—— 可见降级的依据 */
    autoplayBlocked: boolean;
  };
  /** 只读快照与不变量自检（供 `window.__ls.dump()` 与测试直接断言 C-11/C-12） */
  snapshot(): RemoteAudioSnapshot;
  invariants(): { sink: { muted: boolean; connected: boolean; srcObjectSet: boolean }; exclusivity: { bothAudible: boolean; pipelineRunning: boolean } };
  /** 用户手势解锁（同时恢复 `muted`/`volume`，不只 `resume()`）—— PR 看门狗的另一半 */
  unlock(): void;
  dispose(): void;
}
```

**硬性要求**：
1. `setStream` 之后必须启动存活看门狗（**双通道**：`ctx` 的 `statechange` 事件 + 间隔 ≤ 1000ms 的轮询兜底 —— 部分平台/路由切换不发 `statechange`）；一旦 `ctxState !== "running"`，**在同一 tick 内**把元素恢复为可发声（`muted=false`, `volume = min(1, prefs.volume)`），并令 `audibleVia = "element"`。
2. **反抖动（C-10b）**：ctx 恢复 `running` 后**不自动切回**管线（否则会在后台↔前台之间抖动）；切回只发生在 `setStream` / `setPrefs` / `unlock` 三类显式时机。
3. **单写者**：`el.muted` / `el.volume` / `el.srcObject`（音频）/ `el.play()`（音频）/ `gain.gain.value` / `audibleVia` **只允许 host 内部写**。UI 与会话层一律不得直接触碰。
4. **危险 getter 禁令**：❌ 不得提供 `isActive`（= `ctx !== null`）这种会被误读为"在发声"的 getter —— 它正是 B1 永久静音自锁的入口（`DIVERGENCE.md` **F17**）。建图与否只能叫 `hasGraph()` 且文档必须明示 **≠ 发声**。
5. **一个概念一个计时器 / 一个状态源**：可用性判据只能是 `state.audibleVia`，不得再造第二个"是否在发声"的推导。

### 4.6 会议生命周期（服务端）

```go
type Phase int
const (
    PhaseReserved Phase = iota // 已登记会议号，尚无 SFU 房间（含"创建但从未 join"）
    PhaseLive
    PhaseGrace                 // 在册成员清零，等待重入；**会议号仍保留**
    PhaseEnded
)

type EndReason string
const (
    EndReasonHostEnded    EndReason = "host-ended"           // 房主显式结束会议
    EndReasonReservation  EndReason = "reservation-expired"  // 登记后从未 join，到期回收
    // V1a 实际落地（Architect 已批准）：
    EndReasonGraceExpired      EndReason = "host-left-grace-expired" // 空置宽限到点且仍空
    EndReasonParentTeardown    EndReason = "parent-meeting-teardown" // 主会议拆 → 级联拆 breakout
    EndReasonBreakoutRecalled  EndReason = "breakout-recalled"      // 房主召回 breakout
    EndReasonServerTeardown    EndReason = "server-teardown"        // 其余（防御性兜底）
    // EndReasonCapacity = "capacity-reclaimed" —— 契约草案里的词，**当前无调用点**
    // （本仓无容量回收路径）。保留为预留定义，但不得当作已有能力。
)

// End 是唯一拆除入口。所有既有路径（主动离开、超时、容量回收）都必须经此。
// 实现分两层（V1a）：Machine.End() bool 只做相位 CAS；handler 层
// End(roomID, reason, ctx...) 是唯一拆除入口（停表·广播·RemoveRoomWithReason·
// clear·级联·释放会议号）。语义与本契约一致，签名按需落地。
func (m *Machine) End(reason EndReason)
```

#### 相位跃迁表（V1a 实现依据）

| 当前 | 触发 | 下一相位 | 动作 |
|---|---|---|---|
| （创建登记）| `meeting:create` / breakout 创建 | `PhaseReserved` | 武装 `emptyTimer`，TTL = `meetingReservationTTL`（5min）|
| `PhaseReserved` | 首个成员 join | `PhaseLive` | **停表** |
| `PhaseReserved` | `emptyTimer` 到点 | `PhaseEnded` | `End(reservation-expired)` |
| `PhaseLive` | 在册成员数变 0（**无论显式离开 / 断线 / 踢人**）| `PhaseGrace` | **重新武装** `emptyTimer`，TTL = `meetingGrace` |
| `PhaseGrace` | 有成员重入（C-17）| `PhaseLive` | 停表（会议号从未释放 → 重入必成功）|
| `PhaseGrace` | `emptyTimer` 到点且房间非空 | `PhaseGrace` | **重新武装下一次**（C-19 / F10 修复：不得静默跳过）|
| `PhaseGrace` | `emptyTimer` 到点且房间空 | `PhaseEnded` | `End(host-left-grace-expired)` |
| 任意非 Ended | 房主 `meeting:end` | `PhaseEnded` | `End(host-ended)` —— **立即，不进宽限** |
| 任意非 Ended | 父会议拆除 / breakout 召回 | `PhaseEnded` | `End(parent-meeting-teardown / breakout-recalled)` |

> **⚠ 房主缺席不单独进 `PhaseGrace`**（V1a 实现 + Architect 批准）：房主角色**可转移**，`transferMeetingHost` 保证只要还有成员就一定存在房主 ⇒ "房主缺席"不是稳定态；且既有测试 `TestMeetingHostLeaveTransfersHostAndPreservesMeeting` 锁定"房主离开不得结束会议"。
> ⇒ **不变式：`PhaseGrace ⇔ 在册成员清零`**。若未来要"房主缺席即 Grace"，必须一并改那条测试的不变量。
>
> **空置判定的三个来源**（V1a 实现，比 F10 原条件 `room.Count() > 0` 更宽、更正确）：在册成员 · SFU 参与者 · 进行中的 join。

**计时器**：全生命周期**只有一个**计时器字段（`emptyTimer`），TTL 由**进入的相位**决定。禁止再出现两个计时器靠守卫对齐（那正是 `DIVERGENCE.md` F10 的成因）。

**reason 词汇表分两套，不得混用**：
- `EndReason` —— 只传给 `End`
- **进入 `PhaseGrace` 的触发原因** —— 复用 `internal/handler/meeting_diagnostics.go` 已上线的枚举（`last-member-left` / `disconnect-grace-armed` 等）；它们**不是** `EndReason`

**不变量**：
- `PhaseGrace` 期间任何成员重入必须成功（返回 200 而非 404），SFU 房间已拆则**重建**。
- `End` 幂等；重复调用不产生第二次副作用（不重复广播、不重复 `clear`）。
- 每个跃迁必须落一条 Info 日志，含 `reason`；**每次会议结束恰好一条** `action=teardown` 权威记录。
- **会议号生命周期与房间占用彻底解耦**（§3 所述“最关键的一次解耦”）：房间空置不等于会议结束。
- **`sessionId` 缺口**：本节与 `CONFORMANCE.md` C-21 要求的 `sessionId` 属 **V1b**（跨 WS→meeting→SFU→客户端的横切改动）。V1a 先落 `roomID` + `participantID` + `clientID`。
