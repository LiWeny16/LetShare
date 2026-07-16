# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

`sw-first-load-version-sync` — Investigating first-load fallback and version sentinel confusion after PRO relay PR push.

## Task Index

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
| `pro-public-relay-auth-sync` | Fix PRO/public relay authorization sync and sender channel selection behavior | Verified | |
| `sw-first-load-version-sync` | Reduce cold first-load false error UI and clarify version/build artifact behavior | Investigating | |

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-07-16 | Treat relay JWT as the authoritative PRO state and refresh custom relay auth before large relay sends when the token changes. | Backend relay authorization is evaluated from `pro_token` at socket handshake time; invite-code cookie alone is insufficient. |
| 2026-07-16 | Keep sender-selected `server` priority explicit and remove silent fallback between relay and P2P. | The bug report requires sender-controlled channel choice to be coherent with actual runtime behavior. |
