---
name: server-relay-stale-client-reset
description: Server relay stale websocket reset handling for deterministic transfer failures
metadata:
  type: project
---

# Server Relay Stale Client Reset

On 2026-07-27, server relay transfers could fail repeatedly with `write: connection reset by peer` while forwarding chunks. The likely failure mode was a stale receiver websocket remaining selectable in the room after reconnect/reset, so retries kept writing relay chunks to a dead connection.

Fix pattern:
- Treat reset/broken/timeout websocket write errors as closed or unusable.
- Remove stale clients after direct relay control or binary writes fail with a closed/unusable connection.
- Prefer the receiver `clientID` recorded during `file:transfer:accept` before falling back to user lookup.
- Retry same-user control messages after removing a stale socket, and rebind relay chunks to a newer active receiver socket if the accepted socket is stale.
- Send protocol-critical `file:transfer:error` messages outside the generic error limiter so the active peer is not left waiting.

Verification used:
- `go test ./internal/service -run "TestWriteErrorClassification|TestSendMessageToUserRemovesClosedClient|TestForwardChunkToReceiverRemovesClosedReceiverClient|TestHandlerRefreshesReadDeadline" -count=1 -v`
- `go test ./internal/handler -run TestNotifyTransferErrorBypassesGenericRateLimiter -count=1 -v`
- `go test ./cmd/... ./internal/... ./pkg/...`
- `go test -race ./cmd/... ./internal/... ./pkg/...`
- `go build ./cmd/server`

Released on 2026-07-27:
- Backend commit `80f71c9` was pushed to `LiWeny16/letshare_server`.
- `/root/cloud/letshare-server-linux` on `ecs.letshare.fun` was replaced with SHA256 `2baf2cffc7bcb1ad7987b6e6af304b67eda578feadac60da6e5d600971d0c40b`.
- `letshare.service` restarted successfully and local ECS `https://127.0.0.1/health` returned healthy.
- Frontend deployment bump: version `3.5.3`, `external-cache-v18`.
