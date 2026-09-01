# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- task-fix-oneway-call-audio — 修复 offerer 音频不被 callee 解码的单通 bug（根因已定位到 app 信令/协商编排时序）

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
