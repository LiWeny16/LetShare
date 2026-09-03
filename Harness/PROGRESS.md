# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- 无（task-meeting-production 已完成：会议功能生产级 3.8.0 上线，线上全功能 25/25 验证通过）

## Task Index

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
| task-meeting-production | 会议功能生产级：画板/聊天/踢人/分组/结束会议/资源回收/屏幕共享重协商 + 线上部署验证 | Done | 2026-09-04 |
| task-fix-oneway-call-audio | Fix one-way audio: callee never decodes offerer stream (root-caused to app signaling/negotiation orchestration) | root-caused | |
| pro-public-relay-auth-sync | Fix PRO/public relay authorization sync and sender channel selection behavior | Verified | |
| server-relay-reset-stale-client | Fix deterministic server relay transfer failure after stale/reset receiver websocket writes | Verified | 2026-07-27 |
| sw-first-load-version-sync | Reduce cold first-load false error UI and clarify version/build artifact behavior | Verified | 2026-07-16 |
| readme-product-docs-refresh | Clarify LetShare pain points, transfer modes, limits, and local development docs in English and Chinese | Verified | |

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-09-04 | 断线不立即回收会议号，走 12s 宽限（任何成功加入取消定时器） | share.tsx 卸载会 disconnect → WS 弹跳是正常流程（创建→跳转→join），立即回收会误杀会议 |
| 2026-09-04 | 会议 chat/draw 服务器纯转发零存储，前端本地回显+服务器广播排除发送者 | 小水管约束：零内存/零磁盘开销，省一次发送者回环 |
| 2026-09-04 | 房主显式"离开"=结束会议（无主机转移机制） | 避免无人管控的僵尸会议长期占用 SFU 内存与会议号 |
| 2026-07-16 | Treat relay JWT as the authoritative PRO state and refresh custom relay auth before large relay sends when the token changes. | Backend relay authorization is evaluated from `pro_token` at socket handshake time; invite-code cookie alone is insufficient. |
| 2026-07-16 | Keep sender-selected `server` priority explicit and remove silent fallback between relay and P2P. | The bug report requires sender-controlled channel choice to be coherent with actual runtime behavior. |
