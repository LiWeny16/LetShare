# Local verification record

Date: 2026-09-06 (Asia/Shanghai)

## 2026-09-07 layered-canvas CSS regression closure

### Root cause

The blank scene was a CSS compositing bug in the meeting wrapper, not a white/transparent scene payload. Excalidraw uses separate static and interactive canvas layers. LetShare applied `background-color: #fff` to `.excalidraw__canvas` globally, making the upper interactive layer opaque and hiding the lower static layer. Selection feedback was still visible on the upper layer, which explains why double-clicking or editing temporarily revealed content.

### Fix and UX change

- Removed the blanket `.excalidraw__canvas` background override from `ExcalidrawBoard.tsx`.
- Kept the board container white so the default Excalidraw transparent layers render on a white surface.
- Moved `共享白板 · 已同步` to a fixed position above the meeting footer; the status surface no longer captures canvas pointer events, while the close button remains clickable.
- Expanded `meeting-presentation.e2e.mts` to draw and verify a rectangle, text, and arrow after deselection, assert the interactive canvas is transparent, wait for stability, reload a late guest, and verify takeover.

### Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS, 419 tests |
| `pnpm build` | PASS |
| `cd server; go vet ./...; go test ./...` | PASS |
| Local `meeting-presentation.e2e.mts` | PASS; text, arrow, deselection, sync and panel flows |
| Production `meeting-presentation.e2e.mts` | PASS; meeting `6677`, real Host/Guest, desktop/mobile screenshots |
| Production health/version | PASS; frontend 200, backend health 200, version `3.8.3` |

## Release gates completed

| Area | Command / scenario | Result |
|---|---|---|
| Go static | `cd server; go vet ./...` | PASS |
| Go tests | `cd server; go test ./...` | PASS, all 5 packages |
| TypeScript | `npx tsc --noEmit` | PASS, 0 errors |
| Frontend unit/integration | `pnpm test` | PASS, 446 tests |
| Frontend lint | `pnpm lint` | PASS |
| Production build | `pnpm build` | PASS; Workbox precache limit raised for Excalidraw vendor |
| P0 cold-start | `meeting-p0.e2e.mts` | PASS, 10/10; no cascade fingerprints |
| Meeting collaboration | `.e2e-collab-meeting.cjs` | PASS; public/private chat, directed file, Excalidraw/basic whiteboard |
| Relay fault injection | `P2P_INJECT_CLOSE_MS=2500 MEETING_FILE_MB=20 node .e2e-collab-meeting.cjs` | PASS; P2P close -> relay -> completion + hash |
| Presentation UI | `meeting-presentation.e2e.mts` | PASS; panel toggle, screen, takeover, Excalidraw scene, desktop/mobile |
| Breakout | `meeting-breakout.e2e.mts` | PASS; Host-only create/recall and child-room return |
| Long connection | `meeting-soak.e2e.mts` with `SOAK_MINUTES=30` | PASS, 180/180 samples, browser errors 0 |
| Meeting end isolation | `go test ./internal/handler ./internal/sfu` | PASS; subscribed non-member receives no `meeting:ended` |

## Soak measurements

- Two Chromium clients remained `in-meeting` for 30 minutes.
- Every 10-second sample had at least 2 live remote tracks and 2 visible live-video elements on both clients.
- Samples: 180/180.
- `pageerror` and `console.error`: 0.
- Chromium heap sample: host/guest start 116 MB, final combined sample shown by the test as host 123 MB and guest 103 MB; guest-side measured delta was -13 MB. This is a browser sample, not an SLA.

## Real defect fixed during this gate

`endMeetingRoom` still used the legacy all-subscriber broadcast for `meeting:ended`. That could notify an original-room subscriber who was not a meeting participant. It now uses the SFU meeting-member allowlist, and `meeting_lifecycle_isolation_test.go` prevents regression.

## Historical review limitations

- The independent Codex review tool timed out at 300 seconds and returned no findings; no independent sign-off is claimed.
- The original pre-deployment snapshot did not include online evidence; that gap was closed in the production release addendum below.
- Recording, captions/transcription/translation, hand raise/reactions, waiting room, calendar, tenant audit/SLA and AI meeting features remain explicit roadmap/unavailable capabilities; no visible fake controls should be added for them.

## Production release addendum — 2026-09-06

The previous section is historical gate wording. The remaining release gates were completed as follows:

| Area | Command / scenario | Result |
|---|---|---|
| Frontend deployment | `node scripts/deploy.cjs --frontend --skip-cdn` | PASS; ECS origin 200 and production `version.json` 200 |
| Backend deployment | `node scripts/deploy.cjs --backend` | PASS; systemd restarted; production health check passed |
| Online meeting | `node .e2e-live-release.cjs` | PASS; final post-cleanup run, meeting `7496` |
| Online media | Two real browser clients, camera/audio + SFU subscriptions | PASS; both remote videos playable, both remote audio tracks live |
| Online screen share | Host click → guest receives an additional video | PASS; screen-share track playable online |
| Online collaboration | Public chat + breakout create/recall | PASS |
| Cascade regression | Known SDP/SFU error fingerprints | PASS; none displayed in final run |

### Screen-share flicker regression closure

- Red reproduction: the online smoke observed the same screen track ID with a different `MediaStream.id` after a mute toggle. The defect was deterministic UI rebinding in `MeetingRoom.tsx`, not a failed camera/screen track.
- Fix: memoize the local screen stream by track identity and reuse `RemoteTrack.stream` for remote video tiles.
- Static regression gates: `npx tsc --noEmit`, `pnpm lint`, `pnpm test` (416 pass), and `pnpm build` all PASS.
- Green production run: meeting `4079`; screen share arrived, the screen binding survived a mute toggle with unchanged stream/track identity, and the full smoke ended `LIVE RELEASE SMOKE PASS`.

### Final online root-cause closure

The last online failure was not a missing `getUserMedia` call. The browser and server had a live remote video track, but the SFU consumed subscriber PLI/FIR feedback instead of forwarding a correctly remapped PLI to the publishing browser. A subscriber joining after a keyframe therefore saw `readyState=0` and a 0×0 video despite `track=live`. The SFU now maps the feedback to the publisher track SSRC and requests a keyframe after subscriber answer negotiation. The strict online run passed after this server deployment.

### Release qualification

3.8.3 is deployed and qualified for the verified core meeting scope. It is not a claim of complete Zoom/Feishu/DingTalk parity. Recording/replay, captions/transcription/translation, waiting room, reactions/hand raise, calendar/contacts, tenant administration/audit/SLA, and AI meeting functions remain unavailable/roadmap and must not be exposed as fake controls.

## 2026-09-06 Excalidraw blank-scene regression and white stage

### Root cause

Excalidraw emits an `onChange` with `elements: []` while the editor is mounting or applying a remote scene. The meeting client treated that lifecycle callback as a user edit and published it. The server accepted the empty array, assigned a newer revision, stored it, and broadcast it. A late join/reload could therefore overwrite a valid shared scene with an empty snapshot; double-clicking only caused a temporary local redraw.

### Fix

- Added `src/components/meeting/excalidrawSync.ts` as the tested publication guard.
- `ExcalidrawBoard.tsx` now ignores the initial empty lifecycle callback, while preserving an intentional clear after a non-empty scene exists.
- `MeetingRoom.tsx` changed the shared stage surface from dark navy to white/light raised surfaces while keeping video tiles readable.
- `tests/e2e/meeting-presentation.e2e.mts` now supports `E2E_SITE`, `E2E_WS`, and `E2E_SOURCE_ROOM`, and validates the production UI through DOM state instead of dev-only `window.__meeting` hooks.

### Verification

| Check | Result |
|---|---|
| `node --import tsx --test tests/excalidrawSync.test.ts` | PASS, 3/3; initial empty ignored, non-empty published, intentional clear preserved |
| Local two-browser presentation E2E | PASS; scene remained non-empty after 1.5s and late guest reload |
| Production two-browser E2E, meeting `5213` | PASS; `https://letshare.fun` + `wss://ecs.letshare.fun`, screen-to-Excalidraw, draw sync, 1.5s stability, late reload, takeover |
| `npx tsc --noEmit` | PASS, 0 errors |
| `pnpm lint` | PASS |
| `pnpm test` | PASS, 419 tests |
| `pnpm build` | PASS |

The first production attempt exposed a test-only defect: it relied on the dev-only `window.__meeting` hook and timed out at host readiness. The test was corrected to use the production `meeting-stage` and visible controls; the rerun passed. This was not counted as a product pass.

## 2026-09-07 transparent Excalidraw diagnostic and hotfix

The reported screenshot was reproduced as a diagnostic symptom, but the first pixel probe sampled only Excalidraw's `interactive` canvas. Remote elements are rendered across Excalidraw's static and interactive canvas layers; the probe therefore reported `host=636, guest=0` even though the guest's static canvas contained the scene. After correcting the probe to sample all Excalidraw canvas layers, the local and production runs both showed visible ink on both clients.

The code still contained a real lifecycle race: a remote scene received before `excalidrawAPI` was attached was discarded and never requested again. `ExcalidrawBoard.tsx` now keeps the newest pending remote snapshot and replays it when the API attaches. This prevents a genuine join-time blank board even though it was not the cause of the corrected pixel probe failure.

| Check | Result |
|---|---|
| Local two-browser full-canvas pixel check | PASS; host and guest rendered visible scene after 1.5s |
| Production two-browser full-canvas pixel check | PASS; meeting `3574`, draw sync, deselect-without-disappearing, late reload and takeover |
| `node --import tsx --test tests/excalidrawSync.test.ts` | PASS, 3/3 |
| `npx tsc --noEmit` / `pnpm lint` / `pnpm test` / `pnpm build` | PASS |
| Hotfix deployment | PASS; ECS origin and production version health checks 200 |
