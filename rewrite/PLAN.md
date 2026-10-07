# 实施计划（PLAN）—— 收窄后的纵切片

**架构师**：主 Agent · **分支**：`rewrite/core-v2` · **基线**：`main@336e5ac`
**效力**：本文件服从 `PURPOSE.md`。冲突以 `PURPOSE.md` 为准。

---

## 1. 范围（严格来自 `PURPOSE.md` §2.1）

| 类型 | 项 |
|---|---|
| **做** | R1 通话稳定性状态 · R2 播放客户端组件 · R3 保活 · R4 静音 · R5 双重播放/回声 · R6 注释卫生 |
| **不做** | 文件传输 relay 重构 · call/meeting 机制完整统一 · 聊天/白板/纪要/i18n/PWA · 大而全重构 |

**每片 = 一个已确诊故障 + 它背后那条结构缺陷，一起消灭；且当片即可上线。**

---

## 2. 切片（可上线纵切片，非"先重写后接流量"）

### V0 · 诊断能力（**前置，不是重构**）
- **为什么必须第一**：`PURPOSE.md` §4.4「不在缺少诊断和回退能力时替换核心」；且没有它，后续任何片都无法验证。
- **范围标记**：唯一允许修改旧代码的切片，但仅**加观测、不改行为**
- **Architect 裁决（G2 后）：本片拆为 V0a（已交付）+ V0.1（未完成）。** G2 判决「验收判据仅部分满足」，故 **V0.1 不是可选增强，它是 V0 的完成**

#### V0a · 已交付（G2 = PASS-WITH-CONDITIONS，2026-10-07）
- SFU 主连接状态跃迁 `.Debug` → **Info**，带 `prev_state` / `prev_state_duration_ms` / `ice_state` / `reason`
- **selected candidate pair**：`relayed` / `local_type` / `remote_type` / 脱敏地址
- 客户端 `window.__ls.dump()`：`meeting` / `playback` / `connection` 三段
- 产物：`server/internal/sfu/diagnostics.go`(131) + `diagnostics_test.go`(201)；`src/diagnostics/index.ts`(145) + `tests/diagnostics.test.ts`(73)

#### V0.1 · 未完成（验收缺口，**每一条都直接对应本项目真实踩过的事故**）
| 缺口 | 位置 | 为什么不是「可选增强」 |
|---|---|---|
| **订阅侧 PC 零日志** | `participant.go:386-390` | 正是 **「没声音」** 症状的服务端盲区 |
| **会议层拆除路径零日志**：显式 leave / 踢人 / teardown / **宽限到点被静默跳过** / `SFU 房间已关闭` 无 reason | `websocket.go:1346-1357`、`1855-1870`、`1502-1505`、`room.go:175` | 正是 **「会议不存在或已结束」** 那次事故的盲区 —— 数小时才靠客户端日志定位 |
| **房主角色 / `transferMeetingHost` 无日志** | — | 无法回答「谁先离开」 |
| **`sessionId` 贯穿** WS → meeting/call → SFU participant | — | SFU 日志用 `uniqId`、WS 日志用 `client_id/user_id` → **跨层无法对账** |
| **接线无测试保护**：删掉 `room.go:60` / `participant.go:66` 的调用，全部测试仍绿 | — | V0 的本质路径没有回归防护 = 最大假绿敷口 |
| **`Participant.OnConnectionStateChange` 替换语义** | `participant.go:207` | 潜伏雷：一旦被调用，**同时**失去 Info 日志与 `failed/closed → p.Close()` 清理。当前零调用方（F16）|
| `server_error.log` 轮转（43MB 无轮转）| — | 运维关注点，与归因正交 |
- **V0 整体验收（未达成）**：能**只靠服务端日志**给一次断连写出完整因果链

### V1 · 服务端会议号保活（红队判定必须前置）
- **故障**：重连必得 `404 会议不存在或已结束`（线上 02:33 实事故）
- **结构缺陷**：会议生命周期有 **4 条拆除路径**（`teardownMeeting` / `endMeetingRoom` / `scheduleMeetingEnd` / `finishMeetingMemberLeave`）+ 4 个定时器靠守卫对齐（= `DIVERGENCE.md` F10）
- **交付**
  - 4 条路径收敛为**唯一** `End(reason)` + 策略表
  - **最后一人离开不再立即回收**会议号；宽限到点若房间非空必须**重排**而非静默跳过
  - 会议号生命周期与房间占用**解耦**
- **验收**（`CONFORMANCE.md` C-17/C-18/C-19/C-20）：Grace 内任何成员重入**100% 成功**；`End` 幂等；全员显式离开后 `Phase !== Ended` 直到 reservation 到期
- **追加验收（G2 后回填，V0.1 遗留债务的偿还点）**：
  - **每条会议拆除路径必产 `meeting-end:reason=<enum>` 日志**，且带测试（V0.1 的 12 处会议层接线目前**零测试**，本片必须补上）
  - V0.1 遗留的 3 处无痕点必须按下：同一终止事件的双 `decision` 日志（`handleMeetingEnd` + `endMeetingRoom` —— `End(reason)` 单一入口后自然合并）· `cleanupMeetingClientID` 的成员级离场无日志 · `RemoveParticipant` 无 reason
  - **F10 行为本体**：宽限到点若房间非空必须**重排**而非静默跳过（V0.1 只留痕未修）
- **上线**：服务端独立部署，协议向后兼容

### V1b · `sessionId` 贯穿 + 日志轮转（V0.1b，已由侦察修正范围）
- **原假设被推翻（侦察 + Architect 亲验）**：我说过「SFU 日志用 `uniqId`、WS 日志用 `client_id`，**跨层无法对账**」—— **不完全对**。已验证：
  - `server/internal/handler/websocket.go:388-401`：`userID := userIdParam；若空 → = uniqIdParam`。客户端不发 `userId`（已核验 `CustomConnectionProvider.ts:37-41` 只发 `token/uniqId/userName/pro_token`）⇒ **`user_id` 值 == `uniqId`**
  - `websocket.go:436-440`：连接建立日志**已同时带** `client_id` + `user_id` ⇒ **桥本来就存在**
- **真正的缺口（已核实）**：
  1. **SFU 层日志完全没有连接级标识**（只带 `participantID` = uniqId + roomID）⇒ 同一 `uniqId` 重连时旧/新两条 WS 连接短暂共存，**无法区分某个 SFU 事件属于哪一条连接** —— 这正是「重连拿到 404」类事故的盲区
  2. 字段名三层三个样（`user_id` / `uniqID` / `participantID`），靠「值相等」对账
  3. **多数 WS 日志只带 `client_id` 不带 `user_id`** ⇒ 对账链在那里断掉
- **语义裁定（Architect）**：`sessionId` = **一次 WS 连接**（即 `client_id` 语义），**不**另造在场期 ID。理由：与 V2「会话代次」（旧异步结果不得覆盖新连接）天然对齐，且与 S2a 已交付的 `src/core/transport/ConnectionState.ts:9` 的 `{k:"ready"; since; sessionId}` 语义一致。在场期语义（`attendanceId`）若需要，单列后续片，且必须挂到 `meetingMeta` 级而非 `meetingMembership`（后者断线即删→会静默退化成 sessionId）
- **最小可行切片（排序）**：
  1. 命名定调 + 握手桥接日志补 `uniqID`（`websocket.go` 连接/断开日志）—— 一行级，立刻救回断链
  2. SFU `Participant` 挂 `sessionId`（`participant.go` struct + `room.go` `AddParticipant` 传入，唯一生产调用点；**改签名会波及 `_test.go`，需 grep 补齐**）
  3. SFU 三个高价值日志点补字段：`diagnostics.go` 主连接跃迁、`diagnostics_subscriber.go` 订阅跃迁、`room.go` 参与者离开
  4. 会议日志在 `meeting_diagnostics.go` 的 merged map **统一注入**（一处改，各调用点免改）
- **协议要求：字节零变化**（`client_id` 本就不进任何下行消息体，已核实成员表/`meeting:info`/SDP `to` 均无）
- **附带**：`server_error.log` 轮转（已 43MB 无轮转）
- **待核**：签名的 `_test.go` 调用点数量；是否真存在发 `userId` 的旧客户端

### V0.2 · 连接清理竞态（**P0 级，V1a 期间发现**）
- **发现**：V1a 的 G1 要跑 `go test -race`，结果在**基线 HEAD 上就红**。Architect 建独立 worktree 在 `d0092f9`（= 当时线上代码）复现，竞态栈**全部**落在 `internal/service/websocket.go`：**84 / 101 / 134 / 144 / 415 / 435 / 465 / 466 / 662**
- **性质**：`cleanupClientResources` 把 `client.Events` / `client.Connection` / `client.Metadata` 置 nil 与 `sendToClient` / `writeToClient` 并发；`Shutdown` 写 `onClientDisconnect` 与清理路径读 —— **这是生产活路径，可能丢消息或 panic**，不是测试噪声
- **为什么单独开一片**：它牵连 `model.Client` 全字段访问审计（handler 里 `client.Metadata` 处处在用），**与 meeting 生命周期正交**，不应混进 V1a
- **交付**：`Client` 字段的单一属主 + 关闭顺序状态机；`onClientDisconnect` 写入守卫；拒绝“置 nil 后还会被读”的形态
- **验收**：`go test -race ./internal/handler/ -count=1` **全绿**（基线红 → 绿，可量化）+ `./internal/service` 自有一套 `-race` 测试
- **与 V1b 的关系**：两者都落 `internal/service` 层 ⇒ **同批做，但分开过门**（V0.2 只改并发安全，不动协议字段）
- **优先级**：**高于 V1b 与 V3**。理由：它可能正在线上造成“偶发的消息丢失/断连”—— 正是用户报的症状类

### V2 · 客户端保活与重连必然性（R1 + R3）
- **故障**：
  - **4 分 25 秒零连接尝试**（实测）
  - 后台满 10 分钟被主动断开且不自动重连
- **结构缺陷**：
  - 重连 early-return 静默死锁（`colabLib.ts:1209`）
  - **客户端完全没有"服务端连接存活"探测** —— 现有 ping/pong 全是对端探活（`to: id`），服务端用的是协议级 Ping 帧，JS 不可见 ⇒ **半开连接不可感知**（NAT 重绑定场景）
  - 后台省流豁免只查 `CallManager.isInCall()`，会议不算（`share.tsx:401`）
- **交付**
  - `ConnectionStateMachine` + `RetrySupervisor`（**只做机制**：注入时钟/随机数/退避/取消；重试与否仍由各领域决定 —— 红队第 7 条）
  - 所有退出路径二选一：已排下一次 或 终止态+原因
  - **客户端主动存活探测**（应用层 ping/pong + 超时 → 触发重连）
  - 后台豁免纳入会议
  - 会话代次：旧异步结果不得覆盖新连接（红队第 6 条补入属主表）
- **验收**（C-01/C-02/C-03/C-04 + 新增）：注入半开连接 → **≤30s 内必然发生重连**；后台 15 分钟连接不断

### V3 · 远端音频播放权威（R2 + R4 + R5）
- **故障**：永久静音 / 双重声音 / 回声（全部线上取证）
- **结构缺陷**：远端音频有 **3 个可能的主人**（会话 sink / UI `<audio>` / Web Audio 管线），靠"谁先声明接管"协商；且**声明后永不复查**（`DIVERGENCE.md` F12 / **F17** / **F18** —— 已由只读侦察穷举 + Architect 逐行亲验）
- **已核实的症状机制闭环**
  | 症状 | 机制 |
  |---|---|
  | **双重声音（B2）** | `callSession.ts:269` 有 `el.muted = true`，`callSfuSession.ts:184-195` **漏了**且额外 `play()`；`callManager.attachRemoteAudio` **生产零调用方** ⇒ 自建 sink **必然**与 UI `<audio>` 同时发声 |
  | **永久静音（B1）** | `attach()` 两分支不对称 → 返回 `false` 但 `ctx` 非 null ⇒ `isActive === true` 假象 ⇒ `CallBar.tsx:390` 把元素 `volume = 0` 而管线 suspend ⇒ **全哑且无人复查** |
  | **静音无法自愈** | **全仓零处**监听 `ctx.state`；手势补偿只 `resume()+play()`、**不恢复 `muted`/`volume`**；`play()` reject 被 `catch(() => undefined)` **静默吞** |
- **交付**
  - 收敛为唯一 `RemoteAudioHost`（**单一写者**：`muted`/`volume`/`gain`/`srcObject`/`play()` 只允许 host 内部写；`audibleVia` 是唯一状态；转移函数为**纯函数**）
  - 元素与管线**结构性互斥**（切 pipeline：元素 `muted=true && volume=0` 双保险；切 element：gain 置 0 并 `suspend()` 管线），任何时刻**至少一条通路可用**
  - **删除危险 getter `isActive`** —— `ctx !== null` 被当成"在发声"就是 CallBar 栽的那个坑（F17）
  - **存活看门狗**：`statechange` 事件 + ≤1000ms 轮询双通道；失效 ≤1s 元素接管（**时钟可注入**）
  - 会话内部 sink **一律静音**（C-11），两 session 共用**同一份**实现（X2）
  - 自动播放被拒 → **可见降级**（常驻琥珀色 chip "🔇 声音未开启 · 点此恢复"，点击在手势上下文内恢复）
  - **补 1:1 通话的诊断出口**（V0a 的不完整：`window.__ls.dump()` 的 `playback` 段在通话场景为空）
- **验收**（C-08/C-09/C-10/C-11/C-12 + **真机可听性**）：恰 1 路可听（属性测试穷举 `ctxState × elementState`）；管线失效 ≤1s 回退；**真机 E2E 用 `AnalyserNode` 采 RMS > 0 断言声音存在**（红队第 8 条：模拟状态断言证明不了"可听"）
- **边界**：V3 与 V2 并行，但 **`share.tsx` 属 V2 属地** → V3 若需改它必须在回报里请求跨边界

### V4 · 注释卫生（R6，贯穿 V0–V3 + 终审）
- **规则**：每条被改/删的"教训注释"必须二选一 —— **转成测试** 或 **删除**（禁止用注释代替测试，X7）
- **完整清单已迁至 `rewrite/COMMENT_AUDIT.md`**（只读侦察产出，150 tool uses 全仓扫描 + Architect 抽验）：
  **A 类（描述已不存在的机制 / 危险心智模型）6 条** · **B 类（数值/引用错误）4 条** · **C 类（注释冒充测试 X7）1 条** · **待核实 4 条**
- **其中 3 条已由 Architect 亲验为真**：
  | # | 位置 | 核心事实 |
  |---|---|---|
  | **A1** | `MeetingChat.tsx` 附近（`服务器零存储`）| 服务端 **真的存 200 条并回放**（`meetingChatHistoryMax = 200` + `appendMeetingChatHistory` + `sendMeetingChatHistory`），注释两个半句都假 |
  | **A6** | `callSignaling.ts` / `callManager.ts` / `websocket.go` 的 `handleMediaFrame`（"公网兜底轨道"）| **与实现直接矛盾**：`share.tsx` **无条件**注入 `sfu` ⇒ 生产通话**永远**走 `CallSfuSession` ⇒ 媒体帧隧道（`new CallSession`）**只有单测可达**。而 `callSfuSession.ts:585` 同时又说它"已退役" |
  | **B1** | `websocket.go`（`512KB 限制`）| 真实读上限是 **8MB**（`SetReadLimit(8 * 1024 * 1024)`），全仓无 512KB 限制 —— **会让人据此错误设计分片** |
  | **C1** | `src/app/libs/tools/alert.ts` | **教科书级 X7**：整个 `/* */` 块标注"测试用例"、含断言与"预期输出"，**永不执行**；而 `tests/` 对 alert 的引用全是 grep 源码字符串 |
- **覆盖缺口（必须显式声明，不得当成"全仓已审计"）**：`tests/**` 未逐条核 · `src/pages/share.tsx`（2827 行）仅关键词扫描 · 若干 i18n/landing/聊天面板文件浅扫
- **验收**：清单全部关闭；每条要么有对应测试，要么已删除/改写；**A5 需连同 `pendingChunkIndex` 字段本身一起删**（原清单只列了注释）
- **明确清单（已核实为错/过时）**：完整版见 `rewrite/COMMENT_AUDIT.md`（A 类 6 + B 类 4 + C 类 1 + 待核 4）。原 5 条中已验证的 3 条在本表保留并交叉引用：
  | 注释 | 问题 |
  |---|---|
  | `websocket.go` 帧头 `[callId 16B\|seq 2B\|track 1B\|padding 5B]` | **漏掉 4B 魔数**，与实际布局（`medi`+16+2+1+1=24）不符；连同 `frame[18]`（应为 `22`）一起误导重写者 |
  | `callSignaling.ts:12` 写 `[18)` vs `:136` 写 `22` | 同文件自相矛盾 |
  | `websocket.go` 聊天"纯转发、不存历史" | 实现存 200 条并在 join 回放（**客户端副本**：`MeetingChat.tsx` 的 `服务器零存储` —— `COMMENT_AUDIT.md` **A1**）|
  | `ServerFileTransfer.ts` `pendingChunkIndex` "Bug1 修复" | 描述机制已不存在；**且字段本身零读者，需连同字段一起删**（**A5**）|
  | `reconnectPolicy.ts:12-18` "抖动由调用方叠加" | 调用方并未加抖动 |
  | **新增** `websocket.go` 的 `512KB 限制` | 真实读上限 **8MB**，会误导分片设计（**B1**，已亲验）|
  | **新增** `callSignaling.ts` / `callManager.ts` / `handleMediaFrame` 的"公网兜底轨道" | 生产**不可达**（`share.tsx` 无条件注入 sfu），与 `callSfuSession.ts` 的"已退役"**直接矛盾**（**A6**，已亲验）|
  | **新增** `alert.ts` 的注释"测试用例" | **X7 违规**：永不执行的假测试（**C1**，已亲验）|
- **验收**：清单全部关闭；每条要么有对应测试，要么已删除/改写；**A5 需连同 `pendingChunkIndex` 字段本身一起删**（原清单只列了注释）
- **附带零风险修正**：`frame[18]` → `frame[22]`（仅日志失真，一行）

---

## 3. 顺序（硬约束）

```
V0 诊断（前置，阻塞一切验证）
  → V1 服务端保号（阻塞"重连有效"，红队判定必须早于客户端迁移）
    → V2 客户端保活与重连
      → V3 播放权威
        → V4 注释卫生（贯穿 + 终审）
```

**MUST NOT**：不得跳过 V0；不得在 V1 之前先做客户端重连（否则重连改好也撞 404 —— 红队第 1 条）。

---

## 4. AI Team 与每轮流水线

| 角色 | 模型 | 约束 |
|---|---|---|
| **Orchestrator + Arbiter** | 主 Agent（`deepseek-flash`）| 定契约 · 拆片 · **裁决未决分歧** · 终审 · **唯一合并权** · 调度 · 部署 |
| **Worker** | `mimo-v2.6-pro` | 每轮**只派一个**；只写本片文件 |
| **Reviewer** | `cc-switch-zhipu-glm/glm-5.3`（Zhipu，500k）| **逐条走 `STANDARDS.md` checklist 详审**（**每片必跑**）|
| **Strategic Advisor** | `codex` gpt-6-sol / high | **额度受限**：只答高杠杆战略问题；**不参与逐片 review · 不亲手实现 · 不跑命令 · 不复述计划** |

```
【每片】Worker(mimo) 实现
   └─► G1 静态门（Architect 跑）
   └─► G2 契约门 — Reviewer(glm-5.3) 逐条详审
   └─► G3 评审门 — Architect 裁决未决分歧 + 终审
   └─► G4 证据门 ──► G5 上线门（Architect 部署 + 重启）

【阶段边界】V0 / V2 / V4 收尾，或出现"可能否掉整片排期"的决策
   └─► G3.5 战略审 — Strategic Advisor(codex gpt-6-sol)，单次高杠杆提问
```

**硬规则**：
1. **四方异模型**：Worker `mimo-v2.6-pro` / Reviewer `glm-5.3` / Advisor `gpt-6-sol` / Arbiter `deepseek-flash`。
2. **codex 额度纪律**：只在阶段边界或"排期级"决策时调用；**每阶段 ≤1 次、单片 0 次**；
   禁用于逐条 review / 代码实现 / 跑命令 / 让它读代码库找问题。
   提问前必须先给出**我自己的判断与怀疑点**，只让它**反驳或确认**（一次一问，≤700 词）。
3. 契约被判"不可断言"由 Architect 改契约，不许绕过。

---

## 5. Gates

| Gate | 判据 |
|---|---|
| **G1 静态门** | `tsc --noEmit` ×2（全局 + `tsconfig.core.json` 严格档）· `eslint --max-warnings 0` · `go vet` · `staticcheck` · 文件 ≤400 行 / 函数 ≤50 行 / 复杂度 ≤12 |
| **G2 契约门** | 本片 `C-XX` 全绿；**测试名可读出被保护的不变量**；由 **Reviewer(`glm-5.3`)** 逐条对照 checklist 确认 |
| **G3 评审门** | Reviewer(`glm-5.3`) 详审通过 **且** Architect 裁决完所有未决分歧（拦下的必须给出契约依据）|
| **G3.5 战略审** | **非每片**。仅在阶段边界或"排期级"决策时，单次高杠杆提问 `codex gpt-6-sol`；必须先行给出 Architect 自己的判断与怀疑点，只要它反驳或确认 |
| **G4 证据门**（重写）| **必须声明故障注入矩阵**（半开连接 / 出口 IP 变更 / 后台 N 分钟 / 暂停-恢复 / 丢包率）+ 每格**样本量**与**统计窗口**。判据 = **注入故障后 ≤X 秒内恢复，且恢复期间无用户可见中断**（*已消除"注入中断 vs 静默秒数=0"的自相矛盾*）|
| **G5 上线门** | 按**兼容的客户端-服务端协议组合**灰度（非单片开关）· 验证**新旧版本交叉连接** · 回退路径**实际演练**过 |

**基线**：每片上线前后必须对比 `PURPOSE.md` §3 的 A 类指标（断线后恢复率 / 无声率 / 双声率）。

---

## 6. 分支与回退纪律

- 长期分支 `rewrite/core-v2`，**每周 rebase `main`**
- 新代码落 `src/core/**`；**V0 之外禁止 in-place 修改旧文件**（V1 为服务端，独立部署）
- 灰度按**协议组合**，不做全局开关
- `main` 保持可发布；线上 P0 在 `main` 修，然后 rebase 进来
- **K1 停做条件生效**：某片无法用 A 类指标证明价值 → 停该片，保留已交付收益

---

## 7. 当前状态

- [x] 分支 / 契约层（`ARCHITECTURE.md` `STANDARDS.md` `QUIRKS.md` `CONFORMANCE.md` `DIVERGENCE.md` `PURPOSE.md`）
- [x] S0 坑清单补齐（15 条分叉登记）
- [x] 目的锁定（人类负责人裁决：选 3 + 收窄范围）
- [x] 红队裁决（计划 3 处排序修正 + G4 门重写）
- [x] **V0a 诊断能力** —— 2026-10-07 上线（主连接 Info 跃迁 + ICE 选中候选对 + `window.__ls.dump()`）· G2 = PASS-WITH-CONDITIONS
- [x] **V0.1 归因缺口** —— 2026-10-07 上线（拆除 reason / 订阅侧观测 / 房主变更 / F16 排雷）· G2 = PASS-WITH-CONDITIONS → 打回机械修复 → G1 重跑通过
- [ ] **V0.1b**（`sessionId` 贯穿 WS→meeting/call→SFU→客户端 · `server_error.log` 轮转）← 下一步
- [x] **V0 整体验收（「只靠服务端日志写出完整因果链」）** —— 真实 PC 的 E2E 已产出完整链路（`member-left` / `host-left` / `disconnect-grace-armed` / 订阅 `publisherID` + `relayed`）；`sessionId` 跨层对账仍待 V0.1b
- [ ] V1 服务端保号（**已回填验收项**：每条拆除路径必产 `meeting-end:reason=` 日志且带测试 · V0.1 遗留 3 处无痕点 · F10 行为本体）
- [ ] V2 客户端保活与重连（S2a 机制件已交付待评，属本片）
- [ ] V3 播放权威
- [ ] V4 注释卫生
