# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- task-integrate-meeting-frontend — 会议前端集成收尾(feature/meeting-sfu 分支):创建/加入/分享/成员同步全通,404 toast 已修复(colabLib errText 优先级 + meeting 路由挂 AlertPortal,两修复未 commit)。e2e 全绿。下一:真实双端 SFU 媒体流验证 → 12 号参考图 UI 打磨 → 用户决策 deploy 后端。已知:pnpm test 1 存量失败(publicRelayAuthSync,与本次无关)

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
