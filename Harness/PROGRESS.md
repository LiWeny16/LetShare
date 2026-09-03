# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- task-integrate-meeting-frontend — 会议前端集成收尾:创建/加入/分享全流程 + 成员同步 + 404 提示,已 push(不 deploy)。下一 session:重跑 .e2e-meeting-flow.cjs 看 [C⇐] 帧日志验证 404 toast;真实 SFU 媒体流验证。线上 ecs.letshare.fun 后端为旧版,会议可用需先部署后端

## Task Index

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
| task-fix-oneway-call-audio | Fix one-way audio: callee never decodes offerer stream (root-caused to app signaling/negotiation orchestration) | root-caused | |
| pro-public-relay-auth-sync | Fix PRO/public relay authorization sync and sender channel selection behavior | Verified | |
| server-relay-reset-stale-client | Fix deterministic server relay transfer failure after stale/reset receiver websocket writes | Verified | 2026-07-27 |
| sw-first-load-version-sync | Reduce cold first-load false error UI and clarify version/build artifact behavior | Verified | 2026-07-16 |
| readme-product-docs-refresh | Clarify LetShare pain points, transfer modes, limits, and local development docs in English and Chinese | Verified | |

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-07-16 | Treat relay JWT as the authoritative PRO state and refresh custom relay auth before large relay sends when the token changes. | Backend relay authorization is evaluated from `pro_token` at socket handshake time; invite-code cookie alone is insufficient. |
| 2026-07-16 | Keep sender-selected `server` priority explicit and remove silent fallback between relay and P2P. | The bug report requires sender-controlled channel choice to be coherent with actual runtime behavior. |
