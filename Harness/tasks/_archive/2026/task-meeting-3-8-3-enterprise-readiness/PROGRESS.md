# task-meeting-3-8-3-enterprise-readiness - PROGRESS

## Status

- Phase: Archived
- Next: optional physical-device/media-permission acceptance; no remaining code or deployment gate in this wave
- Blocker: Go race tests are not runnable in this Windows environment because `CGO_ENABLED=1` requires a missing gcc compiler; ordinary Go tests, vet, frontend tests, static checks and browser E2E are green

## Current wave checklist

- [x] Capture user intent and architecture boundary: shared global identity/infrastructure, independent Meeting domain state
- [x] Record current partial implementation and observed focused evidence
- [x] Define M-01..M-12 acceptance criteria, execution waves, verification commands and release gates in `PLAN.md`
- [x] W0 rerun interrupted baseline tests and record PASS/FAIL/NOT RUN
- [x] W1 add/fix AC-linked RED coverage before release review
- [x] W2 complete/review backend Meeting registry, media state and Meeting-aware file authorization
- [x] W3 complete/review route identity and frontend Meeting projection/teardown
- [x] W4 complete/review Meeting chat/files/invite lifecycle UI
- [x] W5 finish responsive/visual/accessibility audit at desktop, 390px and 320px
- [x] W6 full local suites + 10-cycle critical journey + soak
- [x] W7 independent read-only review + reflector PASS; no new blocker found (no external sign-off claimed)
- [x] W8 bump to 3.8.7, standard backend/frontend deploy and production E2E

## Current wave evidence

- PASS: focused Go Meeting media-state test.
- PASS: focused Go Meeting file-transfer test across different legacy rooms with membership authorization.
- PASS: `pnpm exec tsc --noEmit` after current changes.
- PASS: `tests/e2e/meeting-visual-ux.e2e.mts` against Vite `:5173` and current Go server `:18080`, including live remote camera on/off, avatar fallback, focus, 320px settings, mobile-to-desktop text/image/file, exact downloaded bytes, cancel, leave cleanup and rejoin.
- PASS: the repaired local E2E batch: state machine, visual/mobile UX, directed invite + leave/re-invite, presentation/whiteboard, no-media, P0 media/screen share, breakout recall and AI minutes.
- PASS: the critical two-browser state/media journey repeated 10/10 cycles against the real Go server and Vite browser app.
- PASS: `pnpm test` 430/430, `go test ./... -count=1`, `go vet ./...`, `pnpm lint`, and `pnpm exec tsc --noEmit`.
- PASS: local TURN-disabled fallback now returns JSON 404 through the narrow Vite proxy and the client cleanly uses STUN; no HTML JSON parse fingerprint remains.
- NOT RUN: Go race tests; the machine has no gcc for cgo. This is an environment limitation, not a passing claim.
- PASS: independent read-only review found no new blocker; external reviewer was unavailable, so no external sign-off is claimed.
- PASS: v3.8.7 build, backend-first deployment, frontend deployment, live health/version/TURN checks, Meeting production E2E, and audio/video call production E2E.

## Current repair wave evidence (2026-09-09)

- The no-media E2E initially failed before join because it omitted the generated-identity Meeting name gate. After adding the real gate interaction, it passed with `NotFoundError` capture failures and `data-stage=in-meeting`; media failure no longer blocks Meeting membership.
- The breakout and AI-minute browser tests had the same omitted name-gate assumption. Both were amended to follow the real UI and pass against the Go server.
- The file-relay source assertion had been coupled to legacy `client.UserID`; it now verifies the centralized identity ownership adapter, preserving stable `uniqID` authorization for Meeting while retaining legacy compatibility.
- `MeetingChat` attachment object-URL cleanup now captures the mounted Set in the effect cleanup, clearing the last lint warning without changing transfer behavior.
- The development Vite proxy only covers `/api/turn-credentials`; production routing remains unchanged.

## Release closure (2026-09-09)

- Version bumped to `3.8.7` in `package.json` and the MobX source version.
- `pnpm build` passed; backend deployment completed before frontend deployment. Both origin health checks returned 200. CDN refresh was skipped only because Aliyun CDN credentials are not configured; ECS origin and GitHub Pages artifacts were deployed.
- Live checks passed: `https://letshare.fun/version.json` reports `3.8.7`; `https://ecs.letshare.fun/health` is healthy; `/api/turn-credentials` returns the production UDP/TCP TURN servers with a 600-second TTL.
- Production Meeting E2E passed for state/heartbeat/disconnect/rejoin/invalid-room, visual/mobile/file UX, directed invite/leave/re-invite/reject, presentation/whiteboard, and no-media join.
- Production call E2E passed for two-client voice and video through forced TURN relay. Assertions use actual `ontrack`, RTP bytes/packets, selected relay candidates and mute/unmute recovery; synthetic microphone `audioLevel=0` remains diagnostic only.
- Final local gates remain green: `pnpm test` 430/430, `go test ./... -count=1`, `go vet ./...`, `pnpm lint`, TypeScript, and the 10-cycle critical browser journey. Go race tests remain unavailable on this Windows host because gcc is not installed.

## Tasks

- [x] Read project rules and prior 3.8.2 evidence
- [x] Research official Zoom/Feishu/DingTalk/Excalidraw baselines
- [x] Define quantified AC and no-fake-feature gate
- [x] Audit current LetShare feature routes, controls, server APIs and state ownership
- [x] Reproduce and fix P0 bidirectional media reliability
- [x] Implement authoritative presentation state and Excalidraw collaboration
- [x] Repair panel/whiteboard/meeting UI and run screenshot click matrix
- [x] Run regression, fault injection and performance evidence
- [ ] Independent review (external reviewer timed out; no independent sign-off claimed)
- [x] Bump/deploy 3.8.3 and run online smoke/E2E

## Changes

- Created the 3.8.3 enterprise readiness capsule and recorded competitor baselines, release thresholds and evidence.
- Fixed the remaining `meeting:ended` cross-channel broadcast path and added a non-member isolation regression test.
- Added real breakout and 30-minute meeting-soak browser tests; both pass locally.
- Fixed the last observed remote-video black-frame path: SFU subscriber RTCP PLI/FIR feedback is now translated to publisher-SSRC PLI, and the subscriber requests a keyframe after answer negotiation.
- Added an online release smoke that verifies playable bidirectional camera/audio, a delivered screen-share track, public chat, breakout create/recall, controls, and absence of the known SDP/SFU cascade fingerprints.
- Fixed the production screen-share flicker regression in `MeetingRoom.tsx`: stable screen-track keyed `MediaStream` identity and reuse of manager-owned remote streams prevent unrelated mute/camera state updates from rebinding `<video>` elements.
- Added a real participant-panel private-chat shortcut that selects the existing directed `meeting:chat` target; file attachment continues to use the already verified P2P/Relay transfer path.

## Verification

- Research sources and thresholds are recorded in `PLAN.md` and `COMPETITOR-GAP-MATRIX.md`.
- Local static gates, P0 10/10, collaboration, relay fault injection, presentation/Excalidraw, breakout and 30-minute soak are recorded in `artifacts/LOCAL-VERIFICATION.md`.
- Production smoke passed against `https://letshare.fun/` with the live Go server at `wss://ecs.letshare.fun/`; see the release addendum in `artifacts/LOCAL-VERIFICATION.md`.
- The product is release-qualified for the verified core meeting scope, not full Zoom/Feishu/DingTalk feature parity. Missing enterprise capabilities remain explicitly documented as roadmap/unavailable.
- Post-fix online smoke passed with meeting `4079`: bidirectional camera/audio, screen-share delivery, same-stream binding after mute toggle, public chat, breakout create/recall, and no known SDP/SFU cascade fingerprints.
- The subsequent online smoke passed with meeting `5831` and additionally clicked the participant private-message shortcut before resetting to public chat; no browser errors or meeting cascade fingerprints were observed.

## Excalidraw blank-scene closure (2026-09-06)

- Fixed the reported behavior where a shared Excalidraw scene became white after about one second and reappeared temporarily after double-clicking.
- Root cause was a mount-time empty `onChange` being published as a newer server snapshot. The server was behaving consistently with the invalid client publication; the fix is to suppress only lifecycle-empty snapshots and preserve intentional clears.
- Changed the meeting stage surface to white/light raised surfaces.
- Local and production two-browser E2E passed, including late guest reload and 1.5-second stability. Production meeting `5213` passed screen-to-Excalidraw, drawing sync, and guest takeover.
- Current final gates: TypeScript PASS, lint PASS, focused Excalidraw 3/3 PASS, `pnpm test` 419 PASS, build PASS.

## Transparent Excalidraw report (2026-09-07)

- Reproduced and instrumented the reported symptom with a real two-browser test.
- Corrected the diagnostic: Excalidraw uses static and interactive canvas layers; sampling only interactive falsely reported a blank guest. Full-layer production verification passed.
- Added pending remote-scene replay when the Excalidraw API attaches, eliminating a genuine join-time snapshot loss race.
- Hotfix deployed through the standard frontend release flow; production meeting `3574` passed drawing, stability, late reload, and takeover checks.

## Excalidraw layered-canvas CSS regression closure (2026-09-07)

- The user-visible blank canvas was reproduced in the rendered UI, not just in a pixel probe.
- Root cause: `ExcalidrawBoard.tsx` applied `backgroundColor: #fff` to every `.excalidraw__canvas`. Excalidraw renders through layered static and interactive canvases; the opaque interactive layer covered the static scene. Selection outlines/text appeared only because they were painted on the top layer.
- Fix: removed the blanket canvas background override; the board root remains white and Excalidraw's own transparent layer contract is preserved.
- UX fix: moved the `共享白板 · 已同步` status pill to a fixed position above the meeting footer, made the status surface pointer-transparent, and retained pointer events only for the close action.
- Regression coverage: presentation E2E now draws a rectangle, text, and arrow, asserts the interactive canvas is transparent, deselects, waits for stability, reloads the guest, and verifies the shared scene remains visible.
- Local two-browser E2E passed; production two-browser E2E passed with meeting `6677` on `https://letshare.fun`/`wss://ecs.letshare.fun/`, including desktop/mobile screenshots.

## Unified create/prejoin dialog closure (2026-09-07)

- Replaced the user-visible two-step create/created meeting flow with one stable `MeetingCreateDialog`; the same layout now transitions from prejoin setup to the real meeting pass without moving the footer actions.
- Desktop browser verification: 760 × 579 px before and after creation; the real Go server generated the meeting number and URL; clipboard-permissioned copy changed to `已复制`; entering navigated to `#/meeting?room=...&owner=1`.
- Responsive browser verification: 390 × 844 px had body scroll width 390 px and no horizontal overflow; device selectors, microphone test, latency test, and default-off camera/microphone controls remained reachable.
- Full regression after the change: TypeScript PASS, `pnpm test` 419 PASS + 33 call tests PASS, Go vet PASS, Go test PASS, production build PASS. Visual evidence is in `design-qa.md` and the task artifacts.
- Published with `node scripts/deploy.cjs --frontend`; ECS origin returned 200, `https://letshare.fun/version.json` reports 3.8.4, and `https://liweny16.github.io/LetShare/` resolves to the same 3.8.4 deployment. A fresh online create→copy→enter smoke created meeting `1468`, reached `in-meeting`, and had no page errors, console errors, or failed requests.

## MeetingPreparation reference alignment (2026-09-07)

- Compared the live merged dialog against `C:\Users\rockchip\Downloads\MeetingPreparation.jsx` and the supplied target capture at the same 760px dialog width.
- Refined the dialog to use a separated heading block, reference grid ratio (`1.618fr` + `minmax(280px, 1fr)`), reference gray preview/blue avatar, explicit host/camera-off labels, collapsed device diagnostics, and the reference metal Meeting Pass decoration.
- Fixed a real stability regression in the new diagnostic area: the microphone-level row now reserves a fixed height; the browser E2E verifies no modal reflow or control-size change after toggles and tests.
- Refined screenshot evidence: `design-qa.md`, `meeting-unified-create-desktop-refined.png`, `meeting-unified-created-desktop-refined.png`, and `meeting-unified-create-mobile-refined.png`.
- Post-refinement gates passed: TypeScript, `pnpm test` (419 + 33 call tests), `go vet ./...`, `go test ./...`, focused meeting-prejoin browser E2E, and `pnpm build`.
- Republished with `node scripts/deploy.cjs --frontend`; frontend origin and live version checks passed, `https://letshare.fun/version.json` reports 3.8.4, and GitHub `main` advanced to `694a0873764c0b02af67a6923b36404df79a8d04`.
- Production browser smoke passed against the live server: the unified dialog rendered at 760 × 746 px, real meeting creation returned meeting `3788`, clipboard copy produced `https://letshare.fun/#/meeting?room=3788`, entry reached `data-stage=in-meeting`, and no page errors, console errors, or failed requests were observed.

## MeetingPreparation width refinement (2026-09-07)

- Increased the unified dialog desktop width cap from 760px to 840px and set responsive Paper margins to 24px desktop / 12px mobile. This fixes the MUI default-margin squeeze observed at the user's 809px capture: measured width is now 761px at 809 × 654, versus 745px before.
- Re-ran focused real-browser E2E: TypeScript and meeting-prejoin controls pass; 1280 × 800 measures 840 × 746, 809 × 654 measures x=24 / 761px, and 390 × 844 measures x=12 / 366px. All have body scroll width equal to viewport width and no page/console errors.
- New visual evidence is recorded in `design-qa.md` and the `*-wide-v2` artifacts. Source remains on baseline 3.8.4; no version rollback or bump was performed.
- Republished the width refinement through the standard frontend deploy flow. Final live smoke at 809 × 654 measured x=24 / 761px, created meeting `3947`, copied the live invite URL, entered `data-stage=in-meeting`, and observed zero page errors, console errors, or failed requests. Live `/version.json` remained 3.8.4; GitHub Pages sync was triggered by the deploy script.

## Notes

- Worktree contains multiple existing agent changes. Preserve them and inspect ownership before touching overlapping files.

## Image 1 prejoin alignment (2026-09-07)

- Reworked the initial create flow to match `codex-clipboard-hsPlvd.png`: ready heading, real Meeting Pass visible before entry, direct device selectors, compact gray preview, and stable footer.
- Removed the separate microphone and latency test buttons. Microphone level now appears automatically on the preview only after a real microphone stream is enabled; automatic Ping uses green `<=100ms`, yellow `101–180ms`, and red `>180ms` states.
- The create dialog reserves the room through the real Go `meeting:create` API on open, enters the reserved room on “开始会议”, and retries a failed reservation instead of leaving an enabled no-op button.
- Responsive evidence: Playwright passed at 809 × 654, 1280 × 720, and 390 × 844. Desktop runs assert no vertical overflow; all runs assert no horizontal overflow. Media toggles preserve desktop control geometry; no-device meeting join remains covered by `meeting-no-media.e2e.mts`.
- Evidence: `artifacts/meeting-prejoin-ready-809.png`, `artifacts/meeting-prejoin-ready.png`, `artifacts/meeting-prejoin-media-on.png`, `artifacts/meeting-prejoin-ready-mobile.png`, and `design-qa.md`.

## Meeting prejoin media handoff closure (2026-09-13)

- Reproduced the reported difference between ordinary calls and meetings with a red browser regression: the prejoin preview showed microphone/camera enabled, but after entering the meeting `MeetingManager` had `muted=true`, `cameraOn=false`, and both newly captured tracks had `enabled=false`.
- Differential diagnosis: ordinary calls pass the acquired stream directly into `CallManager`; meetings correctly use a separate SFU publish/subscriber topology, but `MeetingPrejoinPreview` released its preview stream without carrying the user's choices into the later `joinMeeting` capture. The room concept was the handoff boundary, not a failure of the SFU media path.
- Fix: persist the preview's microphone/camera intent through the existing meeting settings store; `MeetingManager` then applies the same intent to its fresh publisher stream. Existing shared audio/video capture helpers and SFU code remain reused.
- Regression coverage: the prejoin E2E now asserts the handoff and live enabled tracks; P0 verifies bidirectional camera/audio tracks and rendered video; media-visibility verifies screen rendering and leave cleanup. Local prejoin/P0/media visibility all pass.
- Release gates: TypeScript, lint, `pnpm test` 435/435, Go tests, build and production health checks pass. Frontend `3.8.17` was deployed with `node scripts/deploy.cjs --frontend`; production prejoin and media-visibility E2E pass against `https://letshare.fun` + `wss://ecs.letshare.fun/`.
