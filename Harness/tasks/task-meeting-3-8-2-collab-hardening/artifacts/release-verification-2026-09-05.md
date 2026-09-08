# LetShare 3.8.2 release verification

Date: 2026-09-05 Asia/Shanghai

## Release

- Frontend: `node scripts/deploy.cjs --frontend --no-sync-docs --skip-cdn`
- Backend: `node scripts/deploy.cjs --backend`
- Public build: `https://letshare.fun/version.json` -> HTTP 200, `2026-09-05T08:35:16Z-s0hf7`
- Backend health: `https://ecs.letshare.fun/health` -> HTTP 200, `status=healthy`

## Static gates

- `npx tsc --noEmit` passed
- `pnpm lint` passed
- `pnpm test` passed: 416 + 33 = 449
- `pnpm build` passed
- `go vet ./...` passed
- `go test ./... -count=1` passed
- Go race was not executable in this Windows environment: CGO-disabled mode is unsupported by the race detector, and CGO-enabled mode has no gcc compiler.

## Real browser evidence

- P0 meeting: Host creates and enters alone, Guest joins, media subscription and screen-share renegotiation pass; cascade fingerprints absent.
- Host-only invite: presence list, directed invite, incoming call-style dialog, accept/reject and third-party isolation pass.
- Meeting controls: 29/29 checks pass, including mute, camera, screen share, whiteboard, chat, participants, breakout, kick and end confirmation.
- Collaboration: public chat, private chat, directed file, whiteboard stroke/erase/undo/clear pass in three real browser clients.
- P2P files: 1MB/20MB/100MB normal transfer pass; injected DataChannel close falls back to relay and completes with hash verification.
- Production smoke: two real browser contexts against `https://letshare.fun` and `wss://ecs.letshare.fun`; meeting `4265` created and joined, no meeting/SFU cascade error after 4 seconds, camera/mute toggles and cross-browser public chat pass. Result: `LIVE RELEASE SMOKE PASS`.

## Final audit rerun

- `tests/publicRelayTransfer.cdp.test.mjs`: pass after isolating the local test from the default TURN listener.
- `tests/e2e/meeting-p0.e2e.mts`: pass; Host published independently, Guest received camera/audio/screen tracks.
- `tests/e2e/meeting-invite.e2e.mts`: pass; directed invite, incoming dialog, accept/reject and third-party isolation.
- `.e2e-meeting-controls.cjs`: 29/29 pass.
- `.e2e-collab-meeting.cjs`: pass normally and pass with 20MB P2P close injection followed by relay fallback.
- Final online smoke: meeting `1489`, two browser contexts, no cascade error, media toggles and public chat pass; `LIVE RELEASE SMOKE PASS`.

The older `.e2e-meeting-pro.cjs` and `.e2e-prod-smoke.cjs` scripts were not used as release verdicts because they target a stale local port or stale selectors/initialization. They were treated as harness defects, not silently counted as product passes.

## Scope notes

The current branch is not `main`, so the deploy was intentionally run with `--no-sync-docs`; the deploy script's hard-coded `git push origin main` was not invoked. CDN refresh was skipped because no Aliyun AK was configured. The public endpoint already served the new build and passed the live smoke. Independent Claude/Codex review services were unavailable (missing local Claude binary / Codex timeout); local source review plus automated and real-browser evidence was used instead.
