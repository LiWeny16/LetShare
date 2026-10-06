# 拷贝分叉登记表（DIVERGENCE）

> **这份文件是设计公理 A6 / 禁止模式 X2 的实证依据。**
> 同一条逻辑在 N 处实现且不一致 —— 这是重写（以及原系统 bug 反复出现）的最危险来源。
> 每一条都必须在重写时**收敛为单一实现 + 契约测试**；否则会带着一排绿灯重踩。

状态：`CONFIRMED`（Architect 已亲自核验）· `REPORTED`（Researcher 报告，未独立核验）· `REJECTED`（核验为误报）

| # | 逻辑 | 位置 A | 位置 B / 更多 | 不一致点 | 后果 | 状态 |
|---|---|---|---|---|---|---|
| **F1** | 传输会话状态白名单 | `websocket.go:3910`（chunk，允许 `{transferring,resending,interrupted}`）| `websocket.go:4364`(COMPLETE)、`4426`(ACK)、`4483`(RESEND) | **RESEND 不接受 `resending`**；chunk 不接受 `ending` | 第二次重传请求必被 400 → 客户端 `handleTransferError` **直接杀掉本地传输** → "文件传不完" | REPORTED |
| **F2** | `interrupted` 恢复后回 `transferring` | `file_transfer.go:528-530`(replay) | `file_transfer.go:678-679`(forward chunk) | 只处理 `interrupted`，**不处理 `resending`** | 与 F1 复合构成"越重传越坏"死结 | REPORTED |
| **F3** | 缺失分片枚举 `getMissingChunkIndexes` | `ServerFileTransfer.ts:713-729` | `transferReliability.ts:1588-1605`、`1789-1806` | 三份逐字重复 | 改上限逻辑必漏改 | REPORTED |
| **F4** | 最后一片期望长度公式 | `ServerFileTransfer.ts:591-598` | `transferReliability.ts:1560-1577`、`1690-1700`、`file_transfer.go:358-367`、`colabLib.ts` P2P 侧 | **5 份**；错误处理各不相同（throw / failReceiveSession / 返回 error / 静默丢弃）| 同一畸形输入产生 4 种不同症状 | REPORTED |
| **F5** | 接收端限流上限 | `transferReliability.ts:712-722` | `transferReliability.ts:807-818` | 函数体**完全相同**，后者注释更弱 | 改一处漏一处 | REPORTED |
| **F6** | 内存/缓存/zip/缩略图四组设备上限 | `transferReliability.ts:840-862`、`903-925`、`966-988` | 同文件四段同构代码 | 无共享基表，参数互不成比例 | 无法推理上限来源 | REPORTED |
| **F7** | relay vs P2P 的 ACK 节拍与 stall 超时 | `ServerFileTransfer.ts:220-222`（8 / 24 / 120s）| `colabLib.ts:383-386`（16 / — / 20s）+ `p2pHandshake.ts:88-147` | 同语义两套常量 + 两套实现（内联轮询 vs 纯函数）| 调参只改一边 → "relay 正常 / P2P 卡死"假象 | REPORTED |
| **F8** | 断线清理传输状态 | `ServerFileTransfer.ts:958-996`（清空全部会话）| `ServerFileTransfer.ts:2198-2216`（只清发送）| 两者都**不清** `completedTransferIds`；调用时机不同 | 新会话撞号时 END/ERROR 被永久无视 | REPORTED |
| **F9** | PRO 大小门槛 | `proUpgrade.ts:14`（客户端 cookie 实时判定）| `file_transfer.go:91`（服务端 WS 握手快照）| 阈值同（50MB）但**判定时机不同** | 连接后激活 PRO 的用户：客户端放行、服务端拒绝 → 用户看到莫名其妙的 50MB 限制 | REPORTED |
| **F10** | 会议宽限/回收路径 | `websocket.go:1495-1512`（跳过不重排）| `websocket.go:1442-1450`（explicit→立即拆 / 非 explicit→宽限）| 两套语义 + 定时器复用 | Q19 "宽限只生效一次" | **CONFIRMED** |
| **F11** | 服务端错误通知 | `websocket.go:3708-3740`（受限流）| `websocket.go:4643-4675`（不受限流，双发）| 同一分支先 A 后 B | 重复 toast；关键错误仍需靠 B 才可达 | REPORTED |
| **F12** | 远端音频 sink 是否静音 | `callSession.ts:269`（`muted = true`）| `callSfuSession.ts:184-195`（**漏**）| 拷贝时漏了一行 | **B2 双重声音** | **CONFIRMED** |
| **F13** | TURN 续期后是否重建 allocation | `callManager.ts:738`（`restartIce`）| `meetingManager.ts:1180`（只 `setConfiguration`）| 同一课只在一边学到 | **C2 relay 场景 10 分钟必断** | **CONFIRMED** |
| **F14** | 媒体帧 `track` 偏移 | `websocket.go:3822`（`frame[18]`）| 同文件 `mediaFrameCallID`=4..20、`mediaFrameSeq`=20..21（**正确**）；客户端 `callSignaling.ts:136` = **22** | 同一文件内部自相矛盾；服务端注释 `[callId 16B\|seq 2B\|track 1B\|padding 5B]` 还漏掉了 4B 魔数 | `track` 仅进日志 → 日志失真；**注释会误导重写者按错偏移解析** | **CONFIRMED** |
| **F15** | 后台省流豁免分支 | `colabLib.ts:4566-4570`（通话分支 **re-arm** 定时器）| `colabLib.ts:4572-4574`（直写磁盘分支直接 `return`，**不重挂**）| 两分支不对称 | 直写磁盘请求挂起期间省流被永久解除 | REPORTED |
| **F16** | 主连接状态 handler 的安装方式 | `participant.go:66`（`bindPeerConnection` 内安装）| `participant.go:207`（`Participant.OnConnectionStateChange` 导出方法，**直接透传给 PC**）| Pion v4.0.0 `peerconnection.go:490` 是单槽 `atomic.Value` → **替换语义，无追加**；`room.go:60` 还装了第三份同类 handler | 一旦有人调 `p.OnConnectionStateChange(...)`，该 PC **同时**丢掉 ① Info 跃迁日志（观测静默失效）② `failed/closed → p.Close()` 自动清理（既有的僵尸参与者风险）。当前**零调用方** → 潜伏雷，G2 核验为真 | **CONFIRMED** |

---

## 关键魔法数字（无注释、成对存在、改动即静默失效）

> 完整 40+ 条见 `research/round1-s0-quirks-raw.md` §三。这里只列**改了就会出事**的。

| 常量 | 值 | 出处 | 对偶值（必须同步）| 注释来源 |
|---|---|---|---|---|
| 分片间 `sleep` | **10ms** | `ServerFileTransfer.ts:1656` | — | **无** ← 隐式速度上限 ≈6MB/s；最容易被"优化"掉，改动即线上变更吞吐行为 |
| `RESEND_CHUNK_LIMIT` | 256 | `ServerFileTransfer.ts:216` ↔ `websocket.go:46` | 必须两侧同值 | **无** |
| `MAX_RESEND_ATTEMPTS` | 3 | `ServerFileTransfer.ts:217` / `colabLib.ts:377` | **服务端状态机只允许 1 次**（F1）| **无** |
| `RECEIVE_TIMEOUT_MS` | 30s | `ServerFileTransfer.ts:218` / `colabLib.ts:378` | 服务端 spool 清理 = **10 分钟**（`file_transfer.go:874`）| **无**；与 spool 清理不同量级 → 慢链路（<1MB/s）边传边被清 |
| `RELAY_ACK_STALL_TIMEOUT_MS` | 120s | `ServerFileTransfer.ts:222` | P2P 对偶 = **20s**，差 6 倍 | **无** |
| 等接收方 ACCEPT 超时 | 30s | `ServerFileTransfer.ts:1111` | P2P 对偶 = **5 分钟** | **无** |
| `P2P_READY_TIMEOUT_MS` | 5 分钟 | `colabLib.ts:379` | relay 对偶 = 30s | **无** |
| 设备三档接收上限 | 64MB/200MB/3GB | `transferReliability.ts:717-721` | `:811-815` 完全重复（F5）| 半 |
| 会议 TTL 三件套 | 2min / 5min / 60s | `websocket.go:253/258/262` | 全是 `var`（可被误改）| 有 |

---

## 资产损坏登记

| 资产 | 状态 | 证据 | 处置 |
|---|---|---|---|
| `server/test/websocket_file_transfer.go` | **已损坏不可用** | 579 行 / 5084 字节，仅 **7 个非 ASCII 字符**；标识符与中文注释被整体剥离，只剩 `= "::"` 之类残骸 | 不得作为研究或测试资产；改从 `server/internal/handler/*_test.go`（完好）取证。**需查清是哪个提交/工具造成的** |
| `tests/serverRelayResumeProtocol.test.ts` | **假绿测试** | 只做 `readFileSync` + `assert.match(source, /正则/)` 共 6 处 —— 源码里有字符串就通过，`requestResumeState` 是死代码它也绿 | 必须删除或改写为行为测试（见 `CONFORMANCE.md` §8）|
| `tests/serverRelaySendCompletion.test.ts` | **假绿测试** | 同上手法，3 处 | 同上 |
