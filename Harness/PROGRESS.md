# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- task-meeting-ai-minutes

## Task Index

Non-archived tasks only (max 5). Archived tasks are listed in `Harness/tasks/_archive/INDEX.md` (see `C:/Users/onion/.harness/create-harness-vibe-coding/Harness/specs/protocols/TASK_ARCHIVE.md`).

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
| task-implement-rich-file-previews | Manual browser verification of PDF, MP4/WebM, .md, and multiple selected files at mobile/desktop widths. Then dispatch haiku reviewer. | Validation | - |
| task-meeting-ai-minutes | Ship server-mixed AI meeting minutes (Somni batch ASR + GLM-4.7-Flash) and temporarily disable captions. | Verify | - |

## Current WF Diagnostic Addendum (2026-09-17)

- Mode: wf
- Tier: WF-Standard
- Phase: Closeout
- Gate: VERIFICATION-GATE
- Active question: null
- Goal: fix and verify AI meeting-minutes startup and transcription failures.
- Scope: frontend meeting-minutes state/config/provider path, browser speech-recognition path, backend relay/protocol/config evidence, and relevant automated/manual verification artifacts.
- Non-goals: production deployment and implementing the separate Whisper WASM inference runtime.
- Memory preflight: done
- Memory hints: none (no scenario-specific memory file was required by the loaded router)
- Tier: WF-Standard initially; upgrade only if evidence shows an unresolved cross-layer or high-risk contract issue.
- Next: archive task after user confirms closeout.

### Diagnostic Dispatch Ledger

| Dispatch ID | Role | Status |
|-------------|------|--------|
| 01a0acfc-b2fa-7350-9469-0ddd202c99e9 | codebase-explorer | Returned |
| 01a0acfc-b433-70f1-b3a1-cea85a3b815c | codebase-explorer | Returned |
| 01a0acfc-b55e7-a91-872e-204516388328 | codebase-explorer | Returned |
| 01a0acfc-b67f-73d0-88f1-b49816822b2f | docs-researcher | Returned |
| 01a0acfc-b799-7fa0-893e-7d22bc55b2fb | planner | Returned |
| 01a0ad06-7023-78c2-9116-62e81bf19112 | verifier | Returned |
| 01a0ad06-715f-7ae1-be4d-9282d34ad6cb | reviewer | Returned |

### Diagnostic Evidence Matrix (2026-09-17)

| Acceptance | Confirmed | Hypothesis / unresolved | Next evidence |
|------------|-----------|-------------------------|---------------|
| AC-001 | `startWithConfig` sends meeting start, waits only 100ms, then may show a generic error; valid server configure/start sets running and broadcasts `started`. Keys are direct browser-to-provider data and are not in `meeting:minutes` WS. | Screenshot startup error may be a 100ms race, Ably frame drop, server rejection, or another runtime transport issue. | Browser/CDP capture of configure/start/started/error frames, connection mode, provider request/status, and timing. |
| AC-002 | `SpeechRecognition: network` does not invoke the final-result callback; only final `onresult` updates and broadcasts transcript. The error path leaves `BrowserSpeechSession.running` true and `onend` may restart. | Exact browser speech-service cause is unresolved: origin/secure context, permission, browser service, proxy/VPN, or platform support. | Real-browser Console/CDP event sequence plus origin, browser version, `isSecureContext`, permission state, and network evidence. |
| AC-003 | `pnpm exec tsx --test tests/meetingAi.test.ts` passed 10/10; `go test ./internal/handler -run TestMeetingMinutes -count=1` passed. | These tests do not cover real browser SpeechRecognition `network` or 100ms runtime timing; no final acceptance claimed. | Run the bounded runtime checks above before any fix. |

### Runtime CDP Evidence (2026-09-17)

- Used real visible Edge `153.0.4234.32` and Chrome `152.0.7977.83` against the local Vite app on `27772` and a local Go WebSocket server on `27771`; no fake SpeechRecognition implementation or headless browser was used.
- With the custom-server auth token missing, both browsers repeatedly failed the custom WebSocket connection and the UI showed the all-signaling-servers-failed state. Supplying the exact server auth token restored the connection and real two-browser meeting membership. This is independent of the MiMo/API key.
- In a real meeting, Chrome as the server-authoritative host emitted `meeting:minutes` `configure`, `consent`, and `start`; the server returned `configured` and `started`, and the live manager state became `running: true`. The API key was absent from these frames.
- The same restart showed a timing window: after `start` was sent, the manager state was still `running: false` at roughly 100ms and became `true` later (about 700ms in the bounded observation). The UI code's 100ms check can therefore surface a stale generic startup error before the asynchronous `started` event arrives; this is a confirmed race window, not yet the sole explanation for every screenshot.
- Real browser speech capability checks were positive in both browsers (`isSecureContext === true`, `SpeechRecognition` and `webkitSpeechRecognition` were functions). Edge produced the actual UI error `SpeechRecognition: network`; no final-result callback followed that error in the failing run, so no transcript was recorded on that path. Chrome completed the meeting-minutes start path in the same environment, showing the speech failure is browser/service-path-specific rather than the meeting WebSocket startup itself.
- After an Edge reconnect, the server transferred host authority to Chrome while the Edge UI retained stale meeting-minutes state. That creates a second concrete failure mode: a stale/non-host tab cannot reliably control host-only minutes actions even if its panel still says configured.

### Implementation and Final Verification Addendum (2026-09-17)

- Event-based `configured`/`started` acknowledgement replaced the 100ms startup race.
- Terminal browser speech errors now abort and stop recognition instead of restarting indefinitely.
- MiMo ASR key handling now preserves a dedicated ASR key and falls back to the summary key when needed.
- Targeted unit tests (11/11), Go meeting-minutes tests, TypeScript check, production build, and repository Playwright E2E (1/1) passed.
- Real visible Chrome/Edge CDP verification passed with MiMo ASR HTTP 200 responses, rendered final segments, completed stop flow, and HTTP 200 summary generation. No key was recorded in source or Harness files.
- The earlier local E2E 502 was a Vite proxy/backend-port mismatch; the test passed after setting `LETSHARE_DEV_BACKEND_HTTP` to the active backend.

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-09-04 | 断线不立即回收会议号，走 12s 宽限（任何成功加入取消定时器） | share.tsx 卸载会 disconnect → WS 弹跳是正常流程（创建→跳转→join），立即回收会误杀会议 |
| 2026-09-04 | 会议 chat/draw 服务器纯转发零存储，前端本地回显+服务器广播排除发送者 | 小水管约束：零内存/零磁盘开销，省一次发送者回环 |
| 2026-09-04 | 房主显式"离开"=结束会议（无主机转移机制） | 避免无人管控的僵尸会议长期占用 SFU 内存与会议号 |
| 2026-07-16 | Treat relay JWT as the authoritative PRO state and refresh custom relay auth before large relay sends when the token changes. | Backend relay authorization is evaluated from `pro_token` at socket handshake time; invite-code cookie alone is insufficient. |
| 2026-07-16 | Keep sender-selected `server` priority explicit and remove silent fallback between relay and P2P. | The bug report requires sender-controlled channel choice to be coherent with actual runtime behavior. |

## 2026-11-06 Server-Mixed Minutes Implementation

- Captions are hidden behind `LIVE_CAPTIONS_ENABLED = false` in `MeetingRoom.tsx`; caption code remains in place for later restoration.
- The SFU fanout now exposes an audio RTP tap. `MeetingAudioMinutesSession` decodes each consenting publisher's Opus with pure-Go `github.com/pion/opus`, mixes 20 ms frames to 16 kHz mono PCM16, and sends 20 s batches to Somni's WebSocket using the non-streaming start/audio/stop/final flow.
- Server minutes start/stop/teardown now owns mixer lifecycle. Transcript segments are broadcast as `speakerName: 会议音频` with the active `recordingId`; no speaker names are invented.
- The host summary path always calls the protected server AI action, which uses fixed `glm-4.7-flash`. The BYOK provider/key UI was replaced with a server-side information panel.
- Server env accepts `MEETING_ASR_STREAM_*` with `SOMNI_ASR_*` fallbacks. `GLM_API_KEY` stays server-side; `MEETING_AI_ENABLED=false` remains a hard off switch.
- Verification: `go build ./...`, `go vet ./...`, `go test ./... -count=1`, `npx tsc --noEmit`, and `tests/meetingAi.test.ts` passed. A real Somni probe passed for silence and for a synthetic Chinese TTS WAV (30 runes returned). `pnpm test` passed 833/834; the single failure is an unrelated flaky file-transfer test that passes in isolation. `pnpm lint` still reports only pre-existing errors in unrelated files.

## 2026-11-06 Meeting Assistant Private Chat

- Added a pinned `会议助手` private-chat contact. It is not a meeting member or SFU participant.
- `meeting:chat` to `ai:meeting-assistant` is intercepted server-side; the assistant gets only the current meeting summary plus up to 120 recent transcript segments, streams short answers back to the asker only, and stores the private Q/A in per-user filtered chat history.
- Added `live-notes` and `final-minutes` model tasks. The small panel is now Yuanbao-style: expandable overview card + `以下为会中实时笔记` + bottom `立即总结` / `去提问 AI 助手`.
- The assistant uses a lightweight streaming + three-dot thinking animation for the first version; `assistant-ui` remains a possible presentation-layer replacement.
- Verification: real `tests/e2e/meeting-ai-assistant-chat.e2e.mts` passed (real meeting → assistant private chat → streaming Gemini answer), `pnpm test` 834/834, `go test ./internal/handler`, and `go vet ./...`.
