# 注释审计清单（V4 执行输入）

> 由只读侦察 `research-comments`（150 tool uses / 200.8k token）产出，Architect 抽验后入库。
> **规则**：每条处置必须二选一 —— **转成测试** 或 **删除/改写**（`STANDARDS.md` X7：禁止用注释代替测试）。
> **定位方式**：行号会漂移（`websocket.go` 正被 V1a 改）→ **一律用引号内的注释原文 grep 定位**。
> 状态：`VERIFIED`（Architect 亲验）· `REPORTED`（侦察报告，未独立核验）· `PENDING`（待核实）

## A 类 · 描述已不存在的机制 / 危险心智模型（最高优先）

| # | 位置 | 注释原文 | 为什么错 | 处置 | 状态 |
|---|---|---|---|---|---|
| **A1** | `src/components/meeting/components/MeetingChat.tsx:132` | `// 内存保护：仅保留最近 200 条（刷新即清空，服务器零存储）` | **两个半句都假**。服务端存 200 条并回放：`websocket.go:254` `meetingChatHistoryMax = 200`、`:2000` `appendMeetingChatHistory`（`:2012-2013` 按 200 截断）、`:2017` `sendMeetingChatHistory`，调用点 `:1070`（join）、`:1094`（join）、`:2045`（history 请求）。且客户端挂载即 `requestChatHistory()`，刷新后历史**会长回来** | 改写为"内存 200 条上限（服务端另存 200 条回放历史）"；删"刷新即清空，服务器零存储" | **VERIFIED** |
| **A2** | `src/components/meeting/components/Whiteboard.tsx:12-13` | `服务器纯转发（handleMeetingDraw），零存储；刷新后画布为空（与聊天一致）。` | 白板部分对，但"**（与聊天一致）**"在断言聊天也是零存储 —— 反证同 A1。**错误事实的第二处扩散**，会让重写者认为整个协作面都无状态 | 删"（与聊天一致）"或改为"（聊天不同：服务端存 200 条）" | REPORTED |
| **A3** | `src/app/libs/connection/ServerFileTransfer.ts:1278-1280` | `* 接受文件传输 — 在此处分配缓冲区, 确保用户确认后才占用内存` | 张冠李戴 + 机制已死。该函数是 **direct-to-disk**（`session.buffer = null`），**从不分配缓冲区**；缓冲区在 `acceptTransfer` 里且仅 `≤100MB` 时分配。且"用户确认后"已不存在（`showAcceptDialog` 无条件 `resolve(true)`）| 删除该 JSDoc 或改写为"direct-to-disk：取得句柄后转入 acceptTransfer" | REPORTED |
| **A4** | `src/app/libs/connection/ServerFileTransfer.ts:1248-1276` | `* 显示接受对话框` + `// 暂时自动接受…` + `// TODO: 替换为非阻塞的 React/MUI Dialog` | 函数**不显示任何对话框**；它防的 `confirm()` 早已删除（尸体注释就在下方 `:1266-1276`）。TODO 的前提（存在阻塞式 confirm）已不成立，**现状是"无提示全自动接受"** | JSDoc 改"当前自动接受（无 UI）"；TODO 改写为真实缺口"缺少可拒绝的非阻塞接受 UI"；删 `:1266-1276` 注释尸体 | REPORTED |
| **A5** | `src/app/libs/connection/ServerFileTransfer.ts:170-172` + `:1739` | `* 下一个待写入块的真实索引…二进制帧写入后重置回 -1。` + Bug1 注释 | `pendingChunkIndex` 全仓仅 3 处：声明、初始化 `-1`、赋值 —— **零读者，也没有"重置回 -1"的代码**。二进制帧用的是帧自带的 `meta.chunk_index`。**字段与注释同属一套已死机制** | **连同字段一起删除**（V4 原清单只列了 `:1739` 一行，删时别漏字段本身与它的注释）| REPORTED |
| **A6** | `src/app/libs/call/callSignaling.ts:8-14` · `src/app/libs/call/callManager.ts:8` · `server/internal/handler/websocket.go` 的 `handleMediaFrame`（"公网兜底轨道"）| `媒体帧协议（公网兜底轨道）…服务器按帧盲转发` / `由 colabLib 注入公网媒体帧收发（public 轨道）` | **与实现直接矛盾**：`share.tsx:328` **无条件**注入 `sfu` 依赖 → `callManager.ts:562` 构造 `CallSfuSession` ⇒ `callManager.ts:583` 的 `new CallSession(...)`（唯一用媒体帧隧道的实现）**生产不可达，只有单测能走到** ⇒ 服务端 `handleMediaFrame` **同样不可达**。而 `callSfuSession.ts:585/589/597` 明说 `retired P2P signaling path` / `never by the old frame tunnel`。另外 `handleMediaFrame` 注释里"服务器不维护通话会话表"**已被推翻** —— 通话房间以 `c_<callId>` 登记进 `activeMeetingRooms` 并复用会议 SFU 流程 | 三处统一标注"**legacy：仅非 SFU 构造（单测）可达，生产通话走 `call:sfu:*`**"；删"不维护通话会话表"的论断 | **VERIFIED**（Architect 亲验 `share.tsx:328` 无条件注入 + `callManager.ts:562` 分支）|

## B 类 · 数值 / 引用错误

| # | 位置 | 注释原文 | 为什么错 | 处置 | 状态 |
|---|---|---|---|---|---|
| **B1** | `server/internal/handler/websocket.go`（`512KB 限制` 那行）| `// 原样转发（数据已在 conn 层 512KB 限制内），补充发送者便于去重回显。` | 真实读上限是 **8MB**：`conn.SetReadLimit(8 * 1024 * 1024)`（同文件）。全仓再无 512KB 限制。**会让人以为 meeting:draw 有 512KB 上限并据此错误设计分片** | 改为"（conn 层读上限 8MB，见 SetReadLimit）"；若确实期望有界，应补真实的 draw 上限 + 测试 | **VERIFIED** |
| **B2** | `src/app/libs/connection/colabLib.ts:987` | `* 服务器 switch message.Type 按 meeting:join/leave/sdp/ice 路由（websocket.go:359）` | 引用的行号指向 `HandleWebSocket` 入口，真正的 `switch message.Type` 在 `processMessage`。**偏了 200+ 行** | 改为"（websocket.go processMessage 的 switch）"，去掉易漂移的裸行号 | REPORTED |
| **B3** | `src/app/libs/call/callManager.ts:128` | `* 历史：此函数曾刻意剔除 TURN（注释还写着 never use a TURN relay）` | "注释还写着…"是**现在时的假陈述** —— 该旧注释已不存在（全仓仅命中这一行自身）| 删"（注释还写着 never use a TURN relay）"，保留历史教训本身 | REPORTED |
| **B4** | `src/app/libs/connection/ServerFileTransfer.ts:506-507` | `* 处理二进制文件块数据 — 直接写入预分配缓冲区, O(1) 无额外拷贝` | 写入实为**三模式**（sink / ≤100MB 预分配 buffer / >100MB `receivedChunks` 数组）；且"无额外拷贝"不实 —— chunk 模式是显式 `bytes.slice()` | 改写为"按 storageMode 分派写入"；删"O(1) 无额外拷贝" | REPORTED |

## C 类 · 注释冒充测试（X7 违规）

| # | 位置 | 问题 | 处置 | 状态 |
|---|---|---|---|---|
| **C1** | `src/app/libs/tools/alert.ts:65-100` | **教科书级 X7 样本**：一整个 `/* */` 块标注"简单测试用例"，内含断言式措辞与"预期输出（大致时间点）"，**永不执行**。而 `tests/` 里对 alert 的引用全部是 grep 源码字符串，**没有任何测试执行过防抖逻辑** | 删除整段注释尸体；**防抖不变量落成真单测**（fake timers + `alertEmitter.on('show')` 计数）| **VERIFIED** |

## 待核实（PENDING）

| # | 位置 | 疑问 |
|---|---|---|
| P1 | `src/app/libs/call/remoteAudioPipeline.ts`（"空间展宽…仅单声道生效"）| `MediaStreamAudioSourceNode.channelCount` 在 Chrome 对单声道流是否真返回 1（规范默认 2）。若恒为 2，则 widen **永不触发 = 死代码**。需真机验证 |
| P2 | `websocket.go`（"wsWriteBufferPool 共享写缓冲池，50个连接共用而非各自占 64KB"）| `sync.Pool` 并不限定 50 连接（50 是 `config.go` 的 `max_room_users`），"共用"语义存疑。属措辞不严，未达确认门槛 |
| P3 | `websocket.go`（"64KB 读缓冲 — 匹配文件传输分块大小"）| 分块 64KB **+ 256B 元数据头** > 65536；读缓冲只是 I/O 缓冲并非限制。"匹配"是宽松说法 |
| P4 | `colabLib.ts`（"Bug2 修复: 不在此处预分配缓冲区, 延迟到用户真正接受后再分配"）| 延迟分配机制仍在，但"用户真正接受"这个触发点已退化为**自动接受**（见 A4）。机制未死、语义半死 → 由 Architect 定夺：删历史包袱还是保留教训改写措辞 |

## 侦察已确认无误的区域（避免重复劳动）

`callSession.ts`（会话 sink 注释与实现一致）· `callManager.ts`（TURN/重启 ICE、各常量数值）· `CallBar.tsx`（质量分级阈值）· `meetingManager.ts`（订阅重试、trackId 去重）· `reconnectPolicy.ts`（数列与公式）· `websocket.go` 其余数值（限流、`meetingChatHistoryMax`、邀请 TTL、`mediaFrameCallID/Seq` 偏移）· `service/file_transfer.go`（50MB/3GB/10分钟）· `sfu/*.go`（幂等订阅、closed 不复用、fanout 停播、offer 队列）· `colabLib.ts`（probe 验证、ACK 节拍、探活"≥3≈15s"、后台省流豁免）· `transferReliability.ts` 其余 · `p2pHandshake.ts` · `presenceProbe.ts`

## 覆盖范围声明（**有缺口，不得当成"全仓已审计"**）

- **未扫**：`tests/**`（仅针对"grep 源码冒充测试"模式定位，未逐条核测试语义）· `memory/*.md` · `rewrite/research/**` · `server/cmd/**` · `server/test/**`
- **浅扫（关键词 + 抽读）**：`i18n/translation.ts` · `src/landing/**` · `Settings.tsx` · `ProUpgradeDialog.tsx` · `ImageBubble.tsx` · `FileBubble.tsx` · `ExcalidrawBoard.tsx` · `MeetingAiMinutesDialog.tsx` · `MeetingMediaSettingsDialog.tsx` · `MeetingPrejoinPreview.tsx` · `meetingAi.ts` · `Download.tsx` · **`src/pages/share.tsx`（2827 行仅关键词扫描）** · `ChatPanel.tsx`/`ChatHistoryManager.ts`/`ChatIntegration.ts` · `server/internal/service/websocket.go`
- ⇒ 这些区域**不能保证零遗漏**；V4 若要求"清单全关闭"，必须先补扫缺口或显式声明范围
