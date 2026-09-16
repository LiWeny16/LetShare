# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- task-implement-rich-file-previews

## Task Index

Non-archived tasks only (max 5). Archived tasks are listed in `Harness/tasks/_archive/INDEX.md` (see `Harness/specs/protocols/TASK_ARCHIVE.md`).

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
| task-implement-rich-file-previews | Manual browser verification of PDF, MP4/WebM, .md, and multiple selected files at mobile/desktop widths. Then dispatch haiku reviewer. | Validation | - |
| task-meeting-ai-minutes | Complete and verify the real Whisper WASM runtime, or explicitly split it into a follow-up scope. | Validation | - |

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-09-04 | 断线不立即回收会议号，走 12s 宽限（任何成功加入取消定时器） | share.tsx 卸载会 disconnect → WS 弹跳是正常流程（创建→跳转→join），立即回收会误杀会议 |
| 2026-09-04 | 会议 chat/draw 服务器纯转发零存储，前端本地回显+服务器广播排除发送者 | 小水管约束：零内存/零磁盘开销，省一次发送者回环 |
| 2026-09-04 | 房主显式"离开"=结束会议（无主机转移机制） | 避免无人管控的僵尸会议长期占用 SFU 内存与会议号 |
| 2026-07-16 | Treat relay JWT as the authoritative PRO state and refresh custom relay auth before large relay sends when the token changes. | Backend relay authorization is evaluated from `pro_token` at socket handshake time; invite-code cookie alone is insufficient. |
| 2026-07-16 | Keep sender-selected `server` priority explicit and remove silent fallback between relay and P2P. | The bug report requires sender-controlled channel choice to be coherent with actual runtime behavior. |
