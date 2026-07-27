# server-relay-reset-stale-client - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.

> Task ID: server-relay-reset-stale-client

## Goal

- Outcome: Fix server relay file transfers that now fail deterministically after a receiver-side websocket write reset/stale client condition.
- Non-goals: Rewrite the relay protocol, change P2P behavior, or touch README/public docs.

## Decisions

- Use a narrow WF bounded-pass fallback because the Codex subagent runtime is not exposed in this turn.
- Treat `connection reset by peer` during chunk forwarding as a stale/closed client condition, not a temporary write error that should stay in the room.
- Preserve explicit transfer failure when the receiver is actually disconnected; do not silently claim success.

## Acceptance

- AC-001: A reset/stale receiver websocket is removed from the server client registry so future lookup does not keep selecting the broken client.
- AC-002: Relay file-transfer errors keep `transfer_id` and reach the active peer without being dropped by generic error-rate limiting.
- AC-003: Handler read deadlines consistently use the intended 120s mobile/background tolerance after every successful message.

## Scope

Allowed write set:
- `server/internal/handler/websocket.go`
- `server/internal/service/websocket.go`
- `server/internal/service/file_transfer.go`
- focused Go tests under `server/internal/**`

Forbidden:
- Root README files and existing docs-refresh task files.
- Frontend behavior changes unless backend-only verification shows the bug cannot be fixed server-side.
- Truth files (PRD, ACs, UI/API contracts, test plan, validation report) unless a Change Request is recorded.

## Context

- Loaded: `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`, `Harness/PROGRESS.md`, `memory/server-relay-complete-before-end.md`, `Harness/WF.md`.
- Assumptions: The reported `write tcp ... connection reset by peer` means the receiver websocket object remained selected while no longer writable; current browser logs show server relay, not P2P, is the failing path.

## Agents

Only record agents or bounded passes that materially changed the decision.

| Role | Read / Write Set | Result |
|------|------------------|--------|
| Planner bounded pass | read Harness + server transfer diffs / no writes | Need targeted backend fix and tests for stale receiver cleanup + error notification. |
| Architect bounded pass | read websocket/file transfer paths / no writes | `ForwardChunkToReceiver` and `SendMessageToUser` need closed-connection classification/cleanup; `notifyTransferError` should not rate-limit protocol-critical transfer errors. |
| Test bounded pass | read existing Go/Node tests / no writes | Add Go tests around connection reset classification/removal and update deadline source assertion. |

## Verification

- [ ] `go test ./cmd/... ./internal/... ./pkg/...`
- [ ] focused relay/stale-client Go tests

## Risks

- Local `go test ./...` includes `server/scripts/generate-authtoken.go`, which is not a compilable package.
- `go test -race` requires `gcc` for CGO on this machine.

## Expanded Contracts

### API Contract

| Endpoint | Method | Payload / Response | AC IDs |
|----------|--------|--------------------|--------|
| WebSocket relay | WS | On stale receiver write failure, server removes stale client and emits `file:transfer:error` with `transfer_id` to reachable peer. | AC-001, AC-002 |

### Validation Matrix

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | Pass | `go test ./internal/service -run "TestWriteErrorClassification|TestSendMessageToUserRemovesClosedClient|TestForwardChunkToReceiverRemovesClosedReceiverClient|TestHandlerRefreshesReadDeadline" -count=1 -v` | Stale/closed websocket writes are classified and removed. |
| AC-002 | Pass | `go test ./internal/handler -run TestNotifyTransferErrorBypassesGenericRateLimiter -count=1 -v` | Protocol-critical transfer error reaches sender despite generic limiter state. |
| AC-003 | Pass | `go test ./internal/service -run TestHandlerRefreshesReadDeadline -count=1 -v` | Successful reads use `websocketReadTimeout` at 120s. |
