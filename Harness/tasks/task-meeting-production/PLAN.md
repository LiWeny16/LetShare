# task-meeting-production - PLAN

## Goal

- Outcome: 会议功能达到生产级（对标飞书/Zoom 基础会议）：创建/分享链接/屏幕共享/协作画板 overlay/音视频参会/右侧 realtime chat/离开/结束会议+资源清理/邀请链接加入/404 负例/房主踢人/breakout room。最终部署线上并 CDP 端到端全功能验证。
- Non-goals: 录制、虚拟背景、会议历史存储、权限细分系统、会议预约/日历。

## Decisions

- 全部基于现有架构扩展：SFU(pion) + channel 作用域信令 + membership:snapshot/changed，不引入新依赖。
- activeMeetingRooms 值从 struct{} 升级为 *meetingMeta{Host, Title, Parent, endTimer}（房主权威 + breakout 父子关系）。
- 断线清理修复：handleWebSocket defer 中清理 SFU 参与者 + 空房释放会议号；房主断线走 10s 宽限 AfterFunc（防刷新误杀），房主重入取消。
- chat/draw 服务器纯转发（零存储、零历史），小水管友好；前端事件总线 onEvent 分发。
- breakout room = `<mainID>B<nn>` 注册进 activeMeetingRooms（Parent=主会号），join/leave/信令全部复用现有通道；host 下发 assignments → 定向 invite → 成员自动切换房间（leave+join 复用）→ recall 定向召回。
- createMeeting 快速失败：未连接 WS 立即 reject("未连接服务器")；等待期间收到 error 帧立即 reject（不再空等 5s）。
- UI 按 ds2.png：顶栏(标题/计时/人数) + 主舞台(共享屏/焦点)+视频墙 + 右侧面板(Chat/成员 tabs) + 底部控制条(麦克风/摄像头/共享/画板/更多[host:分组+结束]/离开红钮)。
- 画板：单 canvas overlay，pointer 事件仅在开启时捕获；stroke 增量转发；clear 广播。

## Acceptance

- AC-001: 创建会议 → 分享面板(会议号+链接) → 邀请链接加入 → 双端成员同步、音视频 track 互通（真实双页 CDP）。
- AC-002: 参会者关标签页 → 服务器 SFU 参与者与会议号被释放（go 测试 + 服务端日志证据）。
- AC-003: 房主结束会议 → 所有成员收到 meeting:ended 自动退出，会议号释放。
- AC-004: 房主踢人 → 被踢者收到 meeting:kicked 自动退出+toast，其余成员成员表更新。
- AC-005: 会议 chat：A 发 → B 收（含名字/时间）；不落盘。
- AC-006: 画板：A 画 → B canvas 出现同样笔画；clear 双端清空。
- AC-007: 加入不存在会议号 → 404 toast，不建房。
- AC-008: breakout：host 分组 → B 自动进入 breakout 房间（成员表/聊天/画板按房间隔离）→ host 召回 → B 回主会场。
- AC-009: CDP 全流程清单逐条截图 + zai vision 审核通过；apple-design / make-interfaces-feel-better 审核通过。
- AC-010: 线上部署后（后端 meeting:* + 前端），真实域名 CDP 冒烟：创建/加入/404/leave 全通。

## Scope

Allowed write set:
- server/internal/handler/websocket.go, server/internal/model/message.go, server/internal/sfu/*(最小必要)
- src/app/libs/meeting/meetingManager.ts, src/components/meeting/**, src/pages/meeting.tsx
- src/pages/share.tsx（仅会议 Dialog 小改）, src/app/libs/i18n/translation.ts(会议词条)
- .e2e-*.cjs 测试脚本, Harness/tasks/task-meeting-production/**, Harness/PROGRESS.md
- docs/（部署构建产物, 经 deploy.cjs）

Forbidden:
- 文件传输/P2P/call 相关既有代码（colabLib 仅允许新增会议事件转发，不改既有行为）
- server 其它内部模块（auth/file_transfer/jwt/turn*）除非编译必需

## Context

- Loaded: CLAUDE.md/README.md/Harness 路由、PROGRESS、websocket.go(handler+service)、sfu/{manager,room,participant,subscriber}、meetingManager.ts、MeetingRoom.tsx、meeting.tsx、.e2e-meeting-flow.cjs
- Assumptions: 线上前端已含 meeting 入口（docs/ 已同步）；线上后端为旧版（用户报错根因），本次完成后 deploy。
- 环境: 本地 go server :8080(MODE=local)、vite :5174；探活用 TcpClient.Wait(800)。

## Verification

- [ ] cd server && go vet ./... && go test ./... 
- [ ] npx tsc --noEmit
- [ ] pnpm test（关注存量失败 publicRelayAuthSync 不新增失败）
- [ ] node .e2e-meeting-flow.cjs（回归）
- [ ] node .e2e-meeting-pro.cjs（新功能全清单）
- [ ] deploy backend + frontend → 线上冒烟

## Risks

- 小水管：chat/draw 转发是 O(房间人数) 写锁发送，stroke 频率由前端 pointer 节流控制（~30msg/s 上限单房间）。
- 房主宽限期内的边缘时序（重连竞态）：重入幂等（meeting:join 已幂等）+ endTimer 取消需锁。
