# task-meeting-ai-minutes - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Mode: wf
- Tier: standard
- Phase: complete
- Gate: CLOSED
- Active question: null
- Next action: user verifies real microphone, remote playback, and live notes on the public site

## Heartbeat

- 2026-09-17: Diagnostic verification heartbeat recorded; returned exploration, verifier, and reviewer evidence; source and product files remain read-only.
- Acceptance tracked: AC-001, AC-002, AC-003.

## Dispatch Ledger

| Dispatch ID | Role | Status |
|-------------|------|--------|
| 01a0acfc-b2fa-7350-9469-0ddd202c99e9 | codebase-explorer | Returned |
| 01a0acfc-b433-70f1-b3a1-cea85a3b815c | codebase-explorer | Returned |
| 01a0acfc-b55e7-a91-872e-204516388328 | codebase-explorer | Returned |
| 01a0acfc-b67f-73d0-88f1-b49816822b2f | docs-researcher | Returned |
| 01a0acfc-b799-7fa0-893e-7d22bc55b2fb | planner | Returned |
| 01a0ad06-7023-78c2-9116-62e81bf19112 | verifier | Returned |
| 01a0ad06-715f-7ae1-be4d-9282d34ad6cb | reviewer | Returned |

## Evidence Matrix

| Acceptance | Confirmed | Hypothesis / unresolved |
|------------|-----------|-------------------------|
| AC-001 | 100ms startup wait and server `started` behavior are confirmed; provider/API keys are not in the meeting WebSocket. | Runtime first failure remains unresolved: timing race, Ably frame drop, server rejection, or transport issue. |
| AC-002 | `network` produces no final transcript; the local error path may leave recognition running and restart on `end`. | Browser speech-service cause requires real origin, secure-context, permission, browser, proxy, and event evidence. |
| AC-003 | Targeted TypeScript and Go tests passed (10/10 and pass). | Tests do not cover real browser `network` or 100ms timing; review returned `RETURN_TO_DEBUG`. |

Runtime checks are complete; final acceptance is recorded below.

## Final Verification Addendum (2026-09-17)

- `pnpm exec tsx --test tests/meetingAi.test.ts`: 11/11 passed.
- `go test ./internal/handler -run TestMeetingMinutes -count=1`: passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm run build`: passed.
- `tests/e2e/meeting-ai-minutes.e2e.mts`: 1/1 passed after aligning the Vite proxy target with the local backend; no 502 errors remained.
- Real visible Chrome/Edge CDP run: MiMo ASR request returned 200, three final transcript segments rendered, stop completed, and summary request returned 200. No API key was recorded in source or task files.

## Server-Mixed Minutes Implementation (2026-11-06)

- Decision: pause live captions and make AI minutes the only active meeting-AI path.
- Server audio: SFU `trackFanout` taps the single `ReadRTP` loop, decodes Opus with `github.com/pion/opus`, mixes consenting publishers at 16 kHz mono, and flushes 20 s PCM16 batches. All-silence batches are discarded.
- ASR: `MeetingASRStreamService.Transcribe` implements the Somni non-streaming flow (login, start, wait `started`, upload PCM, stop, collect final text). Real probe passed for silence and for a synthetic Chinese TTS WAV; only the rune count was printed.
- Summaries: the host dialog now always calls `meetingManager.requestMeetingAI("summary", ...)`; the server uses fixed `glm-4.7-flash`. Local BYOK provider/key settings are no longer required or shown.
- GLM detail: `glm-4.7-flash` is a reasoning model. The server now sends `thinking: {type: "disabled"}`; without it, small `max_tokens` budgets are consumed by `reasoning_content` and `content` is empty. Real production-proxy validation returned a 565-byte valid JSON summary. 429/5xx responses now get a bounded retry, and upstream concurrency was reduced to 2.
- Model switch: the production GLM proxy was rate-limited/401 under repeated real-time calls. `MeetingAIService` now accepts an operator-selected model from an allowlist (`glm-4.7-flash` or `gemini-3.5-flash-lite`), with `MEETING_AI_*` / `SOMNI_LLM_*` / `GLM_*` fallbacks. A real Somni Gemini call returned a 1,721-byte valid JSON summary with all required keys.
- Real-time cadence: ASR batches are now 10s; the host summarizes after 2 pending segments or a 10s timer, with a 15s minimum interval and in-flight deduplication.
- Real two-browser E2E passed (room `7718`): browser Opus published 鈫?SFU mix decoded 鈫?Somni ASR returned 3-character batches 鈫?a live Gemini summary appeared **while recording** 鈫?stop produced a final summary. The short transcript made the summary correctly say the meeting contained only scattered fragments, which is the expected behavior for that test audio.
- Private assistant chat: `MeetingChat` now includes a pinned `浼氳鍔╂墜` contact. The server intercepts `meeting:chat` to `ai:meeting-assistant`, builds a bounded context from the current meeting summary plus the last 120 transcript segments, streams short Gemini answers back only to the asker, and stores the private Q/A in meeting chat history (filtered per user on replay).
- UI layout: the small minutes panel now uses a Yuanbao-style overview card (expandable in place) + `浠ヤ笅涓轰細涓疄鏃剁瑪璁癭 feed + bottom `绔嬪嵆鎬荤粨` / `鍘绘彁闂?AI 鍔╂墜`. Clicking the latter opens the existing private chat tab with the assistant selected.
- Assistant E2E passed: `tests/e2e/meeting-ai-assistant-chat.e2e.mts` created a real meeting, started minutes, opened the assistant private chat, sent a question, and received a real streaming Gemini answer (`褰撳墠浼氳璁板綍涓病鏈夊寘鍚换浣曞彂瑷€鍐呭鈥). `pnpm test` passed 834/834; `go test ./internal/handler` and `go vet ./...` passed.
- Captions: toolbar, panel, overlay, and engine auto-switch are gated by `LIVE_CAPTIONS_ENABLED = false`; no caption code was deleted.
- Consent: server mixing only includes participants whose per-recording consent is true. Members accept consent in the existing dialog without opening a local microphone capture session.
- Build: the pure-Go Opus decoder requires Go 1.24, so `server/go.mod`, `server/Dockerfile`, and the Go version docs were bumped from 1.21.
- Verification: `go build ./...`, `go vet ./...`, `go test ./... -count=1`, `npx tsc --noEmit`, `tests/meetingAi.test.ts`, and the new mixer/ASR protocol tests passed. `pnpm test` passed 833/834; the lone failure is the unrelated file-transfer serialization test, which passes in isolation.
- Remaining: deploy with `GLM_API_KEY` and the ASR env vars, then run a real two-browser meeting to verify mixed audio, transcript segments, and the final GLM summary.

## 2026-11-10: Somni package consolidation

- User requests removal of old GLM and unification on the Gemini and Somni services represented by the supplied zip. Existing old GLM implementation is already deleted in the working tree; active code fixes the Gemini model.
- Archive and local configuration values match for model gateway and ASR endpoints/credentials. Values are intentionally not recorded; the archive contains secrets.
- Controller has dispatched read-only archive inspection and disjoint backend/frontend implementation passes. Existing worktree changes must be preserved. Production deployment is not implied.
- Initial targeted checks before edits: frontend meeting AI/history/autosave/question tests 24/24 passed; Go meeting AI/ASR/minutes tests passed.

### Consolidation and verification

- Current client configure messages without a legacy summary provider are accepted; old provider/model fields are ignored and reported state is normalized to the fixed Gemini/Somni configuration. AI capability now reflects the configured key, enabled state, and billing flag.
- Legacy ASR chunk requests use the Somni adapter with bounded concurrency; the generic audio-model ASR implementation remains in the working tree but is not wired into the running server. The existing GLM server file remains deleted.
- Removed obsolete MiMo-specific live tests and unused frontend secret helpers/UI. Member preference patches preserve opt-out; the selected member language persists. Settings describe the expected backend without asserting the identity of an older/custom server.
- Provider contract review: the archive supplies the Somni service protocol but not the ASR engine/model implementation. Current server-mixed minutes use the batch stop/final-result path; the separate disabled caption stream can lose a final result when stopping.
- Verification: `pnpm test` passed before the last targeted frontend review fixes; afterward 19 focused frontend tests and `pnpm exec tsc --noEmit` passed. An isolated `vite build` passed. `go test ./... -count=1` and `go vet ./...` passed.
- Opt-in live checks used synthetic data: Somni batch ASR returned nonempty text, and two later Gemini responses satisfied the frontend's fenced-JSON parser and contained usable notes. The first Gemini response failed an overly strict plain-JSON test; its format was not classified. No raw transcript or model response was saved.
- No fresh end-to-end browser meeting was run in this pass. Existing limitations include approximate speaker attribution in mixed 10-second batches, temporarily disabled captions, and final Markdown not included in the local history record.
- Production inspection found an older running binary and GLM environment configuration; no production deployment, configuration change, or restart was performed. The supplied credential-bearing archive is ignored by git.
- The synthetic WAV was removed after testing. An isolated build output remains in the system temp directory because automatic policy rejected recursive deletion.
- Independent backend review identified a consent/lifecycle gap in the legacy Somni stream: an already opened stream could accept later audio or publish results after consent withdrawal or a stop. Backend follow-up is addressing this before acceptance; independently active captions must retain their existing behavior.
- The Somni batch adapter was tested again with a new synthetic WAV after the write-timeout change and returned nonempty text. Automatic policy blocked deletion of that second WAV as well as the isolated build directory; both remain under the system temp directory.

### User clarification: mandatory minutes notice

- The user clarified that participants cannot opt out of AI meeting minutes: the prompt is notification-only, and all participants' published audio should be included automatically. This supersedes the previous optional-consent and consent-revocation work for minutes.
- Reorienting implementation and tests around automatic server mixing, an acknowledgment-only notice, late joiners, and ordinary stop/leave cleanup. Separate caption-only behavior should not be changed unnecessarily.
- The user also requested ASR VAD so silent audio is not sent. The existing mixer already drops fully silent batches; the new work must additionally reduce silence within transmitted batches, preserve speech boundaries, and be explicit that browser-to-SFU traffic is a separate path.

### Final implementation and validation (2026-11-10)

- AI minutes now mix every current publisher automatically. The recording notice has only an acknowledgement; dismissing it does not control capture, and late joiners are notified for the active recording epoch. Legacy per-speaker input is suppressed while mixed minutes run.
- Server-side 20 ms energy VAD drops long silent spans before Somni requests, retaining 200 ms pre-roll and 300 ms hangover. Batches and queue memory are bounded, and stop flushes pending voice. This reduces server-to-Somni traffic, not browser-to-SFU WebRTC traffic. A fixed energy threshold may miss very quiet speech or pass loud background noise.
- A synthetic WAV padded with silence was run through the production mixer/VAD path and a real Somni request: 437,120 PCM input bytes, 227,840 queued bytes in one voiced batch, and a nonempty transcript. No transcript or credentials were recorded. Gemini gateway probes also returned usable frontend-parseable summaries.
- The user reiterated that live captions must remain disabled. The toolbar, panel, overlay, caption-only capture, and member caption preference are hidden; the server also rejects old-client caption subscription and caption-only recognition requests. Stop and unsubscribe cleanup remain available, and the old implementation remains in the codebase. A duplicate host settings switch that was ignored on save was removed; the workspace start/stop control remains.
- Frontend full tests passed before the final UI-only settings cleanup; afterward the focused notice, AI, translations and auto-save tests (22/22) and TypeScript checking passed. The latest frontend full run had 835/836 pass: the unrelated file-transfer test `R3 keeps a failed task failed when cancel is called later` observed `verifying` instead of `failed`, and failed again in isolation. The earlier isolated frontend build passed. Independent review passed the core minutes and VAD changes. A fresh two-browser meeting was not run because BrowserOS was not connected; the legacy manual browser script was updated for notification-only behavior but not executed.
- After the server-side caption disable guard, `go test ./... -count=1`, `go vet ./...`, formatting checks, and VAD/mixer, provider-readiness and caption-disable race checks passed. The regression tests also confirm that stale caption state cannot activate old ASR routes or interrupt an active server mixer.
- Production was inspected read-only and is still running the older GLM-configured backend; no deployment or restart was performed. The supplied archive contains credentials and is ignored by git. The archived Somni protocol does not establish its ASR model name.
- Remaining limitations: real-room microphone/noise behavior has not been validated in this pass; mixed-batch speaker attribution is approximate and a slow ASR upstream can cause bounded-queue batch drops; final Markdown is not part of local history. Separate caption-only asynchronous revoke/re-consent handling requires review before captions are ever re-enabled.
- Automatic policy blocked cleanup of the isolated build directory and a synthetic WAV under the system temporary directory; no deletion workaround was attempted.

## Local meeting feedback follow-up (2026-11-10)

- The user reported mixed-language minutes settings, JSON rather than Markdown export, missing temporary-disconnect state, missing invite and member-join sounds, no summary for live speech, and a requirement for one shared minutes result. The user also confirmed the other participant could not hear the speaker.
- The earlier local backend mapped its loopback address as a public SFU ICE candidate. An isolated real Pion connection reproduced a stuck publisher and no audio track; ordinary host candidates successfully delivered RTP to both the room audio tap and a subscriber. The loopback branch no longer rewrites candidates, and a persistent real-Pion audio regression was added. The local test backend was restarted with the fix; frontend and backend health endpoints are up. No user speech or identifiers were recorded in this task state.
- Minutes interface translations and Markdown export were implemented; structured-summary exports use the shared summary rather than client-local transcript or timestamps. Network/sound changes and summary cursor/replay are still undergoing review and integration. Live captions remain disabled.

## Public release closeout (2026-11-10)

- Frontend source and built docs/ published as f7cb724 (main); backend submodule pinned to 3766d35. Backend release is live and healthy at https://ecs.letshare.fun/health; public domestic https://letshare.fun/version.json reports 3.9.9 (2026-11-10T09:17:53Z-1o3ks). Frontend deployment keeps the previous release for rollback and retains old hashed assets for active clients.
- Live validation passed: full frontend suite (873 + 35), TypeScript, Vite build; Go full suite, vet and targeted race tests; synthetic Opus→SFU→VAD→Somni flow and live Gemini summary against production egress; public two-member signaling smoke (non-host start, independent pause/resume, coordinator handoff); browser audio regression test. These checks used synthetic audio and did not capture private speech. GitHub Actions CI jobs were not started because GitHub reports the account is locked due to a billing issue; local validation completed independently.
- GitHub Pages deployment completed successfully for f7cb724; a direct GitHub Pages request and the domestic public endpoint both report version 3.9.9 with the expected build ID. Backend health remains healthy.
- Real human microphone capture, remote hearing, and live speech-to-summary still need the user's public two-device confirmation. A meeting's accumulated summary has a 128 KiB safety ceiling; reaching it reports an error and preserves the last valid summary. Raw transcript replay is bounded, so late/rejoining clients may not receive the earliest transcript segments.

## Live minutes UI follow-up (2026-11-10, user report)

- Root cause of the empty overview and dead “立即总结”: the client only learned `latestSegmentSeq` from minutes state broadcasts, but live segment frames do not carry one, so the summary upper bound stayed at 0. `getPendingMeetingSummarySegments` therefore always returned an empty pending batch and every summary request (automatic or manual) was skipped silently.
- Fix: `nextLatestMeetingSegmentSeq` tracks delivered segment sequences in the manager before event dispatch, with unit tests covering the unblocked pending queue. Manual summarize now shows a spinner/“正在总结…” state and a transient “暂无新的发言可总结” hint when nothing new exists.
- 会议脉络 now renders only AI timeline recaps (with decision/action/question chips); the raw transcript remains in the workspace transcript tab and exports. Pausing (“停止接收”) keeps existing notes on screen and only stops new frames instead of clearing local transcript/summary state.
- Verification: TypeScript, meeting unit tests, full frontend suite (875 + 35) passed; `go build ./...` passed and the handler suite passed on rerun (the replay late-join test failed once in the full package and passed in isolation, matching its timing-flaky history).
- Frontend rebuilt and deployed to ECS/CDN; public `letshare.fun/version.json` reports build `2026-11-10T12:40:51Z-0xl9r`. The docs build was pushed to origin/main as 41fb73f through a temporary worktree because the local branch diverged and the working tree contains unrelated pending changes; source changes remain uncommitted locally. Backend was not redeployed; the Gemini prompt wording change applies on the next backend release.

### Join experience follow-up (2026-11-10)

- Fixed the false “会议连接中断” banner on first entry: connection reconnecting/disconnected notices now require the tab to have reached `in-meeting` at least once (`getMeetingConnectionNotice` gained `meetingEstablished`; initial connecting/stale snapshots render nothing, while a genuinely offline browser still shows offline).
- The full-width connection Alert was removed. Transport health now renders in the existing header status cluster (dot + meeting timer): green when connected, amber while joining/reconnecting, red when offline/disconnected, with a compact label and the full explanation in a tooltip.
- Added a standalone `MeetingJoinLoader` component: an inline motion/react SVG of a cute elephant riding a LetShare tile down a slide (~2.95s loop, reduced-motion static pose). It overlays the meeting while `stage === "joining"` with a minimum 900ms display and a soft fade.
- Verification: TypeScript passed; feedback/meeting tests 22/22; full frontend suite 875/876 with only the known flaky `serializes concurrent P2P and relay offers for one transfer ID` failing and passing 44/44 in isolation. Frontend redeployed; public build `2026-11-10T12:53:13Z-a2hv7`, loader chunk and short status strings verified on the CDN; docs pushed as 6cc33ddb.

### Join-screen state machine release (2026-11-10, 3.9.10)

- The meeting surface is now gated by `shouldShowMeetingJoinScreen`: entry, joining, and every reconnection verification render only the full-screen join loader. The real meeting shell cannot mount before the server confirms the room, fixing the “meeting UI first, loader second” flash.
- Reconnection now hides the meeting immediately on transport loss (`connecting`/`reconnecting`/offline/awaiting confirmation) and re-enters only after the manager's `meeting:join` acknowledgement. If the room no longer exists, the existing route-error path receives the manager's `not-found` meetingError and renders the “会议不存在或已结束” page.
- The status chip remains in the header dot+timer cluster. Version bumped to 3.9.10; full frontend suite 877 + 35 passed before release. Public build `2026-11-10T13:07:56Z-2i771`; docs pushed as e4cb0cad.

## 3.9.11 — entry buffer, idle-minutes auto-stop, update prompt, i18n and load perf (2026-11-11)

- Meeting entry: the join loader moved out of the meeting chunk; `/meeting` Suspense now renders `MeetingEntryFallback` immediately, with a shared 700ms entry clock and a 200ms shell fade-in. Established meetings keep their surface through reconnects for 800ms before the buffer takes over. `MeetingJoinLoader` is dependency-free (CSS keyframes, no motion/MUI) so the eager route shell can render it.
- Idle minutes: the server now stops a shared session when every current member has explicitly paused (`receive false`), triggered by personal pause and by member leave; mixes are detached, coordinator cleared and `stopped` broadcast. Go tests cover all-pause, one-receiver-remains, last-enabled-leaves and mixer teardown; the client shows a localized toast.
- Version updates: the build stamps a deterministic `version + sha256(pre-stamp HTML)` id into `<meta name="letshare-build">` and `version.json`; the inline sentinel compares them, polls every 3 minutes, and shows a non-blocking reload card (unregister SW + clear caches + reload; never auto-reloads). The deterministic id keeps the pre-push docs gate stable across rebuilds.
- i18n: 732 literal `t()` keys now covered in en/zh/ms/id with a `tests/i18nKeyCoverage.test.ts` regression test; 30 missing meeting keys added; meeting join errors, the meeting assistant error and the chat render fallback moved to resources.
- Load perf: Excalidraw, the minutes end screen and the parked caption panels are lazy-loaded. Built meeting chunk 1.39MB → 278KB raw (gz 419KB → 81.5KB); end screen 397KB → 6.6KB; Excalidraw CSS 251KB only loads with the board. nginx serves the `.gz` siblings (`gzip_static`), and `deploy.cjs` now warms the meeting chunk's static dependency closure through the CDN. Live cold trace: 10.5s/3.21MB → 4.5s/1.83MB, warm reload 1.2s. The CDN still returns uncompressed bodies (origin gzip is correct); enabling smart compression in the CDN console is the remaining transfer win.
- Release: live build `3.9.11-f2134209f836`; source `7bf0387d`; backend submodule `d8e1c95`. Known: GitHub Actions remains blocked by the account billing lock.
