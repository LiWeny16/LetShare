# task-meeting-3-8-3-enterprise-readiness - ARTIFACTS

Evidence belongs here or under this directory's `artifacts/` folder:

## 2026-09-07 layered-canvas CSS regression closure

- Actual rendered symptom: deselected text/arrows disappeared while selection feedback remained visible.
- Root cause: the LetShare wrapper set an opaque white background on all Excalidraw canvas layers, so the interactive layer masked the static drawing layer.
- Fix: removed `& .excalidraw__canvas { backgroundColor: "#fff" }`; kept the board root white.
- UX: the sync pill is now fixed above the meeting footer and has `pointerEvents: none` except for its close button.
- Local focused E2E: rectangle + text + arrow remain visible after deselection; interactive canvas computed background is transparent; panel opener flow and mobile overflow checks pass.
- Production focused E2E: meeting `6677`, `https://letshare.fun` + `wss://ecs.letshare.fun/`; same rendered checks passed and screenshot shows all three elements visible.

- competitor source links and capability matrix
- server/API and browser event timelines
- local/online Playwright screenshots
- P0 stress-loop results and fault-injection logs
- performance samples and independent review notes
- 3.8.3 build/deploy/version/health outputs

Current local evidence:

- [LOCAL-VERIFICATION.md](./artifacts/LOCAL-VERIFICATION.md)
- [COMPETITOR-GAP-MATRIX.md](./COMPETITOR-GAP-MATRIX.md)
- [Desktop presentation screenshot](./artifacts/presentation-desktop-1280x720.png)
- [Mobile presentation screenshot](./artifacts/presentation-mobile-390x844.png)

The independent review entry remains open: the external review tool timed out and produced no sign-off. This does not invalidate the recorded local review and test gates, but it is not claimed as an independent approval.

## 2026-09-06 production evidence

- Version: `3.8.3`; `https://letshare.fun/version.json` returned `200`.
- Backend: `https://ecs.letshare.fun/health` healthy; `letshare.service` active; deployment health checks passed.
- Online strict smoke: `.e2e-live-release.cjs` passed against the production origin. Meeting `7496` completed the final post-cleanup run.
- Real media proof: both clients reached `in-meeting`; both received playable remote camera video and live remote audio; host screen share produced a third playable video on the guest.
- Collaboration proof: public meeting chat delivered; Host-only breakout create/recall delivered; controls were present and responsive.
- Cascade proof: no `meeting:sdp`, missing-room, missing-publisher, closed-participant, no-ice-ufrag, or subscription-failed fingerprint appeared in the final run.
- Online screenshots: [home](./artifacts/online-home.png), [create meeting dialog](./artifacts/online-create-dialog.png), [desktop presentation](./artifacts/presentation-desktop-1280x720.png), [mobile presentation](./artifacts/presentation-mobile-390x844.png).

## 2026-09-06 screen-share flicker regression

- Red reproduction against production: `.e2e-live-release.cjs` observed the same screen track ID with a different `MediaStream.id` after a guest mute toggle. This isolated the flicker to UI stream rebinding rather than a failed WebRTC track.
- Fix: `MeetingRoom.tsx` now memoizes the local screen stream by track identity and reuses `RemoteTrack.stream` for remote video tiles.
- Static gates after the fix: `npx tsc --noEmit`, `pnpm lint`, `pnpm test` (416 pass), and `pnpm build` all passed.
- Production deployment: `node scripts/deploy.cjs --frontend --skip-cdn` passed.
- Green online proof: meeting `4079`; both clients reached `in-meeting`, remote camera/audio were playable, screen share arrived, the screen video binding survived a mute toggle without changing stream/track identity, public chat delivered, breakout create/recall delivered, and the smoke ended with `LIVE RELEASE SMOKE PASS`.

## 2026-09-06 low-hanging-fruit online proof

- `ParticipantsPanel` now has a per-member private-message shortcut. It switches to the chat tab and selects the target member; the message and file actions remain backed by the existing meeting chat and P2P/Relay transfer implementations.
- The smoke was extended to click this shortcut, verify a private target was selected, reset to the public target, and then complete public chat, screen-share, and breakout checks.
- Green production run: meeting `5831`; `LIVE RELEASE SMOKE PASS`.

## 2026-09-06 Excalidraw and stage-color regression evidence

- Root cause: mount-time Excalidraw `onChange([])` was published as a newer server snapshot and could clear a valid shared scene for all clients.
- Fix: `src/components/meeting/excalidrawSync.ts` guard plus `ExcalidrawBoard.tsx` scene-presence tracking; an intentional clear after a non-empty scene remains valid.
- UI fix: `MeetingRoom.tsx` shared stage is now white/light instead of dark navy; video tiles retain contrast.
- Focused unit regression: 3/3 passed.
- Local two-browser regression: passed, including 1.5s stability and late guest reload.
- Production two-browser regression: passed against `https://letshare.fun`/`wss://ecs.letshare.fun/`, meeting `5213`; screen share → Excalidraw, drawing sync, 1.5s stability, late reload, and guest takeover all passed.
- The production E2E was corrected to avoid dev-only `window.__meeting` hooks; the final production run uses visible DOM state and controls.

## 2026-09-07 transparent Excalidraw diagnostic

- The initial `guest=0` pixel result was a false alarm caused by sampling only Excalidraw's interactive canvas; the scene was present in the static canvas.
- The regression probe now samples all Excalidraw canvas layers and passed locally and online.
- Hardened `ExcalidrawBoard.tsx` against a real API lifecycle race by buffering the newest remote scene until `excalidrawAPI` is attached, then replaying it.
- Production verification: meeting `3574`; draw sync, deselect-without-disappearing, 1.5-second stability, late guest reload, all-layer visible ink, and guest takeover passed.
