# server-relay-reset-stale-client - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Released
- Next: Monitor live relay transfer behavior if the reset case reappears.
- Blocker: none

## Tasks

- [x] Define goal and scope
- [x] Install Go locally for verification
- [x] Add/adjust focused tests
- [x] Implement smallest backend fix
- [x] Verify core backend packages
- [x] Review and close

## Changes

- Installed Go via winget; current Codex process needs PATH refresh per command.
- `server/internal/service/websocket.go`: classifies reset/broken/timeout writes as closed/unusable and removes stale clients.
- `server/internal/service/file_transfer.go`: relay chunks prefer the accepted receiver `clientID`, remove stale clients on direct write failure, retry same-user control messages, and rebind chunks to a newer active receiver socket when the accepted socket is stale.
- `server/internal/handler/websocket.go`: keeps read deadlines at 120s, makes ping shutdown signaling non-blocking, and sends protocol-critical transfer errors outside the generic limiter.
- Added focused backend tests for stale client cleanup and transfer-error delivery.

## Verification

- `go version`: go1.26.5 windows/amd64.
- `go test ./cmd/... ./internal/... ./pkg/...`: passed before implementation.
- `go test ./...`: blocked by non-package `server/scripts/generate-authtoken.go`.
- `go test -race ./internal/...`: blocked by missing `gcc`.
- Focused RED tests fail for reset classification, stale client removal, 120s read deadline consistency, and limiter-bypassed transfer error notification.
- Focused tests after implementation: passed.
- `go test ./cmd/... ./internal/... ./pkg/...`: passed after implementation.
- `go test -race ./cmd/... ./internal/... ./pkg/...`: passed after installing GCC/CGO.
- `go build ./cmd/server`: passed; generated local `server.exe` was removed.
- Backend commit `80f71c9` pushed to `LiWeny16/letshare_server`.
- Deployed Linux binary SHA256 `2baf2cffc7bcb1ad7987b6e6af304b67eda578feadac60da6e5d600971d0c40b` to `/root/cloud/letshare-server-linux`.
- `letshare.service`: restarted and active on 2026-07-27 10:38:39 CST.
- `https://127.0.0.1/health` on the ECS returned `{"status":"healthy"}` after restart.

## Notes

- Root cause likely: stale receiver websocket remained selectable after `connection reset by peer`; relay request/chunk paths could keep targeting that stale connection instead of a newer active socket, making attempts look deterministically broken.
- Frontend release bump for this deployment: app/settings version `3.5.3`, external PWA cache `external-cache-v18`.
