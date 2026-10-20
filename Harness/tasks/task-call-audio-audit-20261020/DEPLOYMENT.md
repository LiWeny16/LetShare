# Production release v3.8.46

User explicitly authorized full frontend/backend rollout on 2026-10-20.

## Scope and preparation

- Publish validated call audio fixes and the current validated stack to production. No new TURN/TLS443, relay-range expansion or regional migration.
- Original developer workspace remains unchanged except task records and the targeted backend source commit. Isolated main worktree: `.tmp/release-call-audio-3.8.46`.
- Root remote-main pre-release tip: `2f427d9`; validated source base: `6b66bd3`; server fix: `d78c8b193947dcad3f7d61732a129db9b439a126`.
- Pre-release ECS frontend was 3.8.45. Service active and `/health` healthy.
- Rollback backup: `/root/cloud/backups/call-audio-3.8.46-20261020/frontend.tar.gz` and `letshare-server-linux`, plus `previous-version.json`. Old binary SHA256: `281e6af13ecd32f21cb5e4b2bf7262ca7aca66ca7ea4bb1e77eef8ec2f475751`.
- Independent release review PASS with required exact content readback, source/artifact branch alignment and retained rollback backup.

## Release evidence

Frontend release version: **3.8.46**. Sentinel build: `2026-10-20T11:43:31Z-7muyr`.

- Source release commit: `ac9b6f3`; production frontend artifacts: `dd016cee6bcba09627e685ac37f12e984d42be87`.
- Frontend rollout used `node scripts/deploy.cjs --frontend --no-build` after the exact build pipeline (cleanup, TypeScript, Vite, dotfile fix, sentinel generation) completed successfully. The already-validated locked dependency tree was reused through a junction in the isolated worktree; no dependency/lockfile changes were made. Local fresh-install attempts were blocked by uncached npm metadata/supply-chain lookup, so they are not claimed as passing install validation. GitHub frontend CI subsequently completed its clean install/typecheck/unit/build successfully.
- The frontend deploy script uploaded/extracted successfully but its artifact-sync step failed because PowerShell removed an empty `GIT_CONFIG_VALUE_0` proxy override. Recovery committed the exact generated docs, then pushed `main` with an explicit per-command proxy override. It did not rebuild or change the deployed bytes.
- Aliyun purge API was skipped because no API credentials were configured. Independent readback confirmed the new sentinel from ECS origin, mainland Tengine CDN, and GitHub Pages (direct GitHub edge connection using the custom-domain TLS hostname).
- CDN and Pages `index.html` SHA256 both match the build: `0becb330730fbf5fa30445601b1e62f9f85c89a04ed2d3a1af059645efc5ccec`. CDN `sw.js` matches `23b3bd6c965c49984eefd160724da1e2ba3d880e75e312295894ff7e4e7eca1e`. Call UI chunk `share-D3oTzHQl.js` matches on both surfaces: `185720367795241dda8b34157d7726097bed3350853f59cf77ecbeb8e956b19f`.
- Pages deployment for `dd016ce`: [successful build](https://github.com/LiWeny16/LetShare/actions/runs/39417600136).
- Release-worktree validation: 134 related client tests, 67 standard frontend unit tests, TypeScript, production build and full Go vet/internal tests PASS. Prior headed Edge/Chrome direct and forced-relay bidirectional audio/recovery evidence remains applicable to the same repaired code.

## CI concurrency correction

The [first release CI](https://github.com/LiWeny16/LetShare/actions/runs/39417602038) passed frontend but detected backend data races in existing WebSocket cleanup: a second unguarded `Connection = nil`, and shutdown clearing the registered disconnect callback while a removal was still invoking it.

- Bounded correction within the authorized repair/release: keep connection reads/writes under `ConnMutex`, remove the redundant unguarded clear, and retain the startup callback for already-claimed removals. Wire formats and frontend artifacts remain unchanged.
- Independent test writer added `TestWebSocketShutdownPreservesClaimedDisconnectCallback`: block removal after map deletion, complete shutdown, release cleanup, require the registered callback exactly once. It compiled and failed functionally before the fix, then passed after it.
- `go vet ./cmd/... ./internal/...` and **`go test -race ./internal/... -count=1` pass** on the corrected backend. Independent source/test review PASS.
- Corrected backend commit: `052e483dfa58802fe39d99354aeb653d2b057406`, published on the server repository's `main`. Canonical backend rollout is repeated for this revision.

Final CI status and release notes: [v3.8.46](https://github.com/LiWeny16/LetShare/releases/tag/v3.8.46). Production health/checksum confirmation is appended after rollout.

## Verification boundary

This release deploys the validated fixes and cache sentinel. Real Singapore–China device audio, physical speakers and TCP-only TURN are not established by the local synthetic audio tests or by HTTP health checks. TLS443, regional routing and relay-port expansion were not part of this rollout.
