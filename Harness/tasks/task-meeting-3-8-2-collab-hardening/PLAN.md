# task-meeting-3-8-2-collab-hardening - PLAN

## Goal

- Outcome: 修复 3.8 会议、媒体、P2P 文件传输的 P0 回归；补齐会议内公聊、私聊、定向文件、同原始房间邀请和来电式提醒；独立升级白板 UI/UX 与工具能力；完成 3.6.14 差异回归、Go server 真实验证和发布前 double-check。
- Non-goals: 本任务不重写 LetShare 原始房间协议，不把会议文件改造成云存储，不在没有端到端证据时宣布 3.8.2 可上线。

## Architecture Decisions

- `meeting:create` 只负责生成并登记会议元数据；创建者不会等待任何成员，也不会依赖远端发布者。
- Host 创建成功后单独执行自己的 `meeting:join + publish`。Host 的 publish readiness 与其他成员的 subscribe readiness 必须是两条状态链。
- “房间内不存在发布者”是订阅方的局部、可重试错误，不能通过通用 `error` 让整个会议回到 `idle`，也不能关闭 Host 的本地 publish PC。
- 原始 LetShare 房间继续提供稳定 `userId/displayName/在线状态/可邀请列表`；meeting 使用独立 `meetingId + meetingParticipant/session`，避免旧 P2P 或旧会议连接污染新会议。
- 原始房间没有主动感知会议的能力，不做会议发现广播；只有 meeting Host 可以从 meeting 路由右上角“邀请成员”中查看同原始房间用户、定向发送邀请，或复制会议 URL。
- 邀请使用原始房间的在线状态/定向消息通道投递，但邀请事件必须携带独立 `meetingId/sourceRoomId/inviteId`；被邀请方收到的是定向来电式提示，不等于原始房间主动发现会议。
- 会议公聊使用 room broadcast；会议私聊使用 `to` 定向消息，并由 server 校验发送者和接收者均为会议成员。
- 会议定向文件复用现有 `userId` 目标和文件传输引擎；会议只增加上下文、成员授权和 UI 入口，不复制一套文件协议。
- P2P 只有在 DataChannel open、probe/ACK、测试数据校验成功后才显示为 P2P；探针或传输 ACK 超时必须自动切换公网 relay。
- 白板由独立 Whiteboard Worker 负责；橡皮擦、撤销/重做等改变协作协议的能力必须同步更新 meeting draw contract，不能只做本地假交互。
- 只有全量真实验证通过后才 bump `3.8.2`，本次任务记录阶段不部署、不改版本号。

## Acceptance Criteria

- AC-001: Host 可以独立完成 `meeting:create`；创建阶段不等待其他成员，也不因远端订阅失败失败。
- AC-002: 两台真实浏览器同时进入会议时，Host publish 与成员 subscribe 有明确顺序；不存在 `meeting:sdp 缺少房间`、`no ice-ufrag`、`参与者已关闭`、不可恢复的“房间内不存在发布者”。
- AC-003: 某个成员订阅失败只影响该成员/发布者组合；Host 的本地会议状态、摄像头、麦克风和共享屏幕仍可操作。
- AC-004: 摄像头、麦克风、屏幕共享真实调用浏览器媒体 API；本地预览、远端 Track、权限拒绝、轨道结束和重试均有可见结果。
- AC-005: 文件传输用真实 DataChannel probe/ACK/hash 判定 P2P；P2P 失败或卡住后自动 relay，不能停在假进度。
- AC-006: 3.6.14 正常的文件、文本和原始房间点对点功能在 3.8 修复后保持通过。
- AC-007: 会议中可选择成员发送私聊、公聊和定向文件；server 有对应消息寻址、成员校验和前端状态反馈。
- AC-008: 原始房间不主动发现或广播会议；只有 Host 在 meeting 路由右上角邀请 Dialog 中查看同原始房间在线用户、逐人发送邀请或复制 URL。被定向邀请的用户收到来电式提示，可接受后一键进入对应 meeting；拒绝、过期、重复邀请有明确状态。
- AC-009: 白板具备真实画笔、颜色、粗细、橡皮擦、撤销、重做、清空和协作同步；工具使用 MUI Icons，触控/键盘可用。
- AC-010: 创建页、会议页、分享弹窗和白板工具栏符合既定设计稿与 Apple-style 交互；所有可见控件都有真实行为或明确禁用原因。
- AC-011: Go server 的房间、会议、SFU、信令、文件 relay、消息和邀请协议均有真实 API/WebSocket 验证证据。
- AC-012: 通过独立 review、真实浏览器验证、回归测试和发布检查后，才允许执行 3.8.2 release flow。

## WF-Max Task List

| ID | Type | Task / Owner | Dependency | Write set | Verification | Status |
|---|---|---|---|---|---|---|
| WF-001 | MAINT | 3.6.14 vs 3.8 前后端差异审计；Audit/Explorer | none | none；只读报告 | git diff、协议矩阵、文件/文本回归入口清单 | Ready |
| WF-002 | MAINT | Host/create/join、meeting session、消息寻址和白板 draw contract；Architect | WF-001 | none；契约与决策 | API/WS payload contract、状态机图、冲突写集审查 | Pending |
| WF-003 | BUG P0 | 修复 Host 独立生命周期与房间绑定；Meeting Worker | WF-002 | `src/app/libs/meeting/meetingManager.ts`, `server/internal/handler/websocket.go` | 双浏览器 create→host join→guest join；Host 不等待远端 | Pending；与 WF-004/005/007/008/009 串行 |
| WF-004 | BUG P0 | 修复 SDP/ICE、publisher-ready、subscriber retry、closed participant 隔离；SFU/Signaling Worker | WF-003 | `server/internal/sfu/*`, `server/internal/handler/websocket.go`、相关 Go 测试 | no-room、no-ice-ufrag、missing-publisher、closed-session 回归 | Pending；server 写集与 WF-003 冲突，串行 |
| WF-005 | BUG P0 | 修复真实摄像头/麦克风/共享屏幕及媒体重协商；Media Worker | WF-003/WF-004 | `src/app/libs/meeting/meetingManager.ts`, `src/components/meeting/hooks/useLocalStream.ts`, `src/components/meeting/MeetingRoom.tsx` | getUserMedia/getDisplayMedia、真实 local/remote Track、权限和轨道结束 | Pending；与会议核心文件串行 |
| WF-006 | BUG P0 | P2P probe、ACK、hash、超时、重试和 relay fallback；Transfer Worker | WF-001；可与会议实现并行但不得改会议核心文件 | `src/app/libs/connection/colabLib.ts`, `src/app/libs/connection/transferReliability.ts`, `server` 文件传输模块及 tests | 1/20/100MB，直连/relay，断网恢复，完成 hash | Pending |
| WF-007 | FEAT P1 | 会议公聊、私聊和定向文件；Communication Worker | WF-002/WF-006 | `src/components/meeting/components/MeetingChat.tsx`、消息 contract、必要的 manager/server/model 文件 | A→all、A→B、A→B 文件；非成员不能收发 | Pending |
| WF-008 | FEAT P1 | Host-only 邀请 Dialog、同原始房间在线名单、定向来电提醒、一键加入和 URL 复制；Invitation Worker | WF-002/WF-003 | `src/pages/meeting.tsx`、`src/components/meeting/MeetingRoom.tsx`、邀请 contract、必要的 manager/server/model 文件 | 不广播会议；Host 点选用户发送；目标用户收到定向 invite；URL 可复制/进入；accept/reject/expire/duplicate | Implemented：协议/服务端校验/前端 UI/Go+FE 测试/双浏览器 E2E 全过；接受后媒体入会（in-meeting stage）被 P0 级联拦截，证据移交 WF-003/004 |
| WF-009 | FEAT P1 | 白板独立升级：工具能力、协作协议和 MUI UI/UX；Whiteboard Worker | WF-002/WF-004 | `src/components/meeting/components/Whiteboard.tsx`、draw contract 相关 manager/server 文件、whiteboard tests | pen/eraser/undo/redo/clear/color/width 多端同步；无假按钮 | Pending；独立白板 lane，不能绕过 contract |
| WF-010 | UI P1 | 创建页、会议页、分享弹窗、下载/消息弹窗比例与 Apple-style polish；UI Worker | WF-007/WF-008/WF-009 | `src/pages/share.tsx`, `src/components/meeting/MeetingRoom.tsx`、必要的 i18n 文件 | 真实浏览器逐控件点击、键盘/触控、截图对照、响应式 | Pending |
| WF-011 | REVIEW | spec/code/security/perf 独立 review；Review Manager | WF-003..WF-010 | none | AC 逐条审查；不得由实现 Worker 自审 | Pending |
| WF-012 | VERIFY | Go server + 两台真实浏览器 + 回归/故障注入验证；Verifier | WF-011 | none；验证报告/证据 | API/WS/CDP/Playwright/手工证据矩阵 | Pending |
| WF-013 | RELEASE | 3.8.2 release gate；CEO/Release Verifier | WF-012 | 仅在批准后允许版本、docs、deploy 文件变更 | build、health、线上冒烟、缓存/后端发布检查 | Pending |

## Expanded Child Tasks for Parallel Repair

这些是 WF-001..WF-013 下的细分任务。只读审计可以并行；有共享文件的实现任务必须按写集串行。

| Child ID | Parent | Type | Bounded task | Exact write set | Parallel rule |
|---|---|---|---|---|---|
| WF-001A | WF-001 | MAINT | 前端路由、user identity、原始房间状态和 meeting 状态差异审计 | none | parallel |
| WF-001B | WF-001 | MAINT | Go server meeting/SFU/participant 生命周期和协议差异审计 | none | parallel |
| WF-001C | WF-001 | MAINT | 3.6.14 文件/文本、3.8 P2P/relay 路径差异审计 | none | parallel |
| WF-001D | WF-001 | MAINT | 双浏览器真实复现脚本和故障注入矩阵设计 | none | parallel |
| WF-002A | WF-002 | MAINT | Host create→join→publish 状态机和错误分类契约 | none | after 001A/001B |
| WF-002B | WF-002 | MAINT | meeting 公聊/私聊/定向文件/邀请消息 payload 契约 | none | after 001A/001B |
| WF-002C | WF-002 | MAINT | 白板 pen/eraser/undo/redo/clear 操作协议契约 | none | after 001B |
| WF-003A | WF-003 | BUG P0 | Host 创建与自身 join/publish 解耦，禁止等待远端成员 | `src/app/libs/meeting/meetingManager.ts` | serial meeting lane |
| WF-003B | WF-003 | BUG P0 | meeting room/source room/meeting session 身份边界修复 | `src/pages/meeting.tsx`, `src/app/libs/meeting/meetingManager.ts` | after 003A |
| WF-004A | WF-004 | BUG P0 | SDP 字段、offer/answer 方向、ICE ufrag 校验和可诊断错误 | `server/internal/handler/websocket.go`, `server/internal/sfu/*` | after 003A/002A |
| WF-004B | WF-004 | BUG P0 | publisher-ready、订阅重试、关闭参与者隔离 | `server/internal/sfu/*` | after 004A; parallel with 005A |
| WF-004C | WF-004 | TEST | Go server meeting/SFU 回归测试和最小复现 | `server/internal/handler/*_test.go`, `server/internal/sfu/*_test.go` | after 004A/004B |
| WF-005A | WF-005 | BUG P0 | getUserMedia、本地视频/音频轨道、权限和真实状态 | `src/app/libs/meeting/meetingManager.ts`, `src/components/meeting/hooks/useLocalStream.ts` | serial with 003A/003B |
| WF-005B | WF-005 | BUG P0 | getDisplayMedia、屏幕轨道、发布 PC 重协商和轨道结束 | `src/app/libs/meeting/meetingManager.ts`, `src/components/meeting/MeetingRoom.tsx` | after 005A |
| WF-005C | WF-005 | TEST | 摄像头/麦克风/屏幕共享浏览器验收与权限故障注入 | none | after 005A/005B |
| WF-006A | WF-006 | BUG P0 | ICE/DataChannel/SCTP probe、ACK、hash 完成判定 | `src/app/libs/connection/transferReliability.ts` | parallel transfer lane |
| WF-006B | WF-006 | BUG P0 | P2P 卡死超时、重试、取消和公网 relay 切换 | `src/app/libs/connection/colabLib.ts` | after 006A |
| WF-006C | WF-006 | TEST | 1/20/100MB、断网、慢 ACK、relay 传输回归 | `tests/*file*test.ts` | after 006A/006B |
| WF-007A | WF-007 | FEAT | meeting 公聊 tab 和消息状态 | `src/components/meeting/components/MeetingChat.tsx` | after 002B |
| WF-007B | WF-007 | FEAT | meeting 私聊 recipient selector 和定向消息 | `src/components/meeting/components/MeetingChat.tsx`, `src/app/libs/meeting/meetingManager.ts` | serial with 007A |
| WF-007C | WF-007 | FEAT | meeting 成员定向文件入口，复用旧传输引擎 | `src/components/meeting/components/MeetingChat.tsx`, `src/app/libs/chat/ChatIntegration.ts` | after 006B/007B |
| WF-007D | WF-007 | TEST | 公聊、私聊、定向文件的成员权限和跨房间隔离 | `server/internal/handler/*_test.go`, `tests/*meeting*test.ts` | after 007A-007C |
| WF-008A | WF-008 | FEAT | Host-only 邀请成员 Dialog、同原始房间在线名单、复制 URL | `src/components/meeting/MeetingRoom.tsx` | after 002B/003B |
| WF-008B | WF-008 | FEAT | `meeting:invite` 定向 server 协议、Host/room/member 校验 | `server/internal/model/message.go`, `server/internal/handler/websocket.go` | serial server lane |
| WF-008C | WF-008 | FEAT | 被邀请方来电式弹窗、accept/reject/expire/duplicate、路由进入 | `src/pages/meeting.tsx`, invitation state files | after 008B |
| WF-008D | WF-008 | TEST | 未被邀请用户不感知会议、目标用户定向收到邀请 | `server/internal/handler/*_test.go`, browser test | after 008A-008C |
| WF-009A | WF-009 | FEAT | 白板工具栏视觉、MUI Icons、响应式和可访问性 | `src/components/meeting/components/Whiteboard.tsx` | dedicated whiteboard worker |
| WF-009B | WF-009 | FEAT | 真正橡皮擦、撤销/重做、操作 ID 和多端同步 | `src/components/meeting/components/Whiteboard.tsx`, draw contract files | after 002C; serial draw lane |
| WF-009C | WF-009 | TEST | 多端笔画/橡皮擦/撤销/重做/清空一致性 | `tests/*whiteboard*test.ts` | after 009A/009B |
| WF-010A | WF-010 | UI | 创建会议后展示会议号、URL、复制和进入会议 | `src/pages/share.tsx` | after 008A |
| WF-010B | WF-010 | UI | meeting shell、面板、底部控制栏和弹窗比例 | `src/components/meeting/MeetingRoom.tsx` | after 005B/008A/009A |
| WF-010C | WF-010 | UI | 所有按钮 hover/focus/loading/error/disabled/empty 状态 | `src/components/meeting/**`, necessary i18n | after 010A/010B |
| WF-011A | WF-011 | REVIEW | AC/spec review：需求是否全部实现、是否出现自动发现会议 | none | after implementation |
| WF-011B | WF-011 | REVIEW | code/architecture/security review：越权邀请、跨房间消息、旧状态污染 | none | parallel with 011A |
| WF-011C | WF-011 | REVIEW | UI polish review：MUI Icon、hit area、比例、键盘和 reduced motion | none | parallel with 011A/011B |
| WF-012A | WF-012 | VERIFY | Go server 真实创建/加入/SFU/消息/邀请协议验证 | none | after 011 |
| WF-012B | WF-012 | VERIFY | 两台真实浏览器媒体、邀请、meeting chat 和 UI 点击验证 | none | parallel with 012A |
| WF-012C | WF-012 | VERIFY | 3.6.14 文件/文本回归、P2P probe/relay 故障注入 | none | parallel with 012A/012B |

## WF-Max Dispatch Rules

- W0 先做只读审计，形成差异和协议证据；未完成审计不得开始跨层修复。
- WF-003/004/005/007/008/009 共享会议核心文件，必须按依赖串行；WF-006 可在不触碰会议核心文件的情况下独立推进。
- 白板必须由独立 Worker 负责，但 UI、交互和 draw 协议要作为一个验收闭环；只改颜色按钮而没有橡皮擦/同步能力视为未完成。
- WF-008 不得实现“原始房间自动出现会议”或全房间会议广播；名单来源只能是同原始房间当前在线状态，发送权限只能属于 meeting Host。
- 每个 Worker 必须携带 role、objective、readSet、writeSet、forbidden、verification、return evidence；CEO 不直接修改生产源代码。
- 所有线上“通过”必须有真实 Go server/API 或真实浏览器证据，单元测试和 build 不能替代端到端验收。

## Scope

Allowed write set:

- 上表各 Worker 声明的精确 write set
- `Harness/tasks/task-meeting-3-8-2-collab-hardening/**`
- `Harness/PROGRESS.md`（仅由 CEO/task-scribe 更新）

Forbidden:

- 在 P0 未通过前 bump/deploy 3.8.2
- 用通用 toast 吞掉 SDP/媒体/传输根因
- 把 ICE connected 当成文件 P2P 成功
- 修改未声明的共享文件，或让实现 Worker 自己承担独立验证
- 删除、重置或覆盖现有用户改动

## Verification

- [ ] WF-001 差异和协议审计完成
- [ ] WF-003..WF-005 会议/媒体 P0 真实复现与回归通过
- [ ] WF-006 文件直连/relay/断线恢复通过
- [ ] WF-007..WF-010 新功能和 UI 逐控件浏览器验证通过
- [ ] `cd server && go vet ./... && go test ./...`
- [ ] `npx tsc --noEmit`
- [ ] `pnpm test`、文件传输专项测试和会议专项测试
- [ ] 独立 review、reflector gate 和线上冒烟通过
- [ ] 以上全部通过后才允许 3.8.2 release flow

## Risks

- 当前会议错误通过通用 error 通道传播，修复时可能暴露更多未分类的协议错误。
- meeting 页面直接 URL 进入时可能没有原始房间状态；需要恢复稳定 user identity，但不能把 token 放入 hash。
- 白板撤销/重做和橡皮擦需要明确操作日志/版本语义，否则只能本地生效，不能宣称协作完成。
- 会议中复用旧文件引擎时必须验证原始 roomId、meetingId、targetUserId 三者不会错配。
