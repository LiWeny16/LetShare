# task-improve-relay-resilience PROGRESS

## Status

- Phase: Verified Phase 0
- Started: 2026-07-27T15:29:15.8665064+08:00
- Closed: 2026-07-27T15:57:00+08:00

## Log

- Created implementation task from the relay/resume review follow-up.
- Identified stale closed-websocket cleanup as the immediate relay failure path to test and fix.
- Identified logger mismatch: current `errors.log` stores warn+error and trims by entry count, not 7-day error-only retention.
- Implemented stale websocket relay rebind hotfix and added regression coverage with disconnect callback enabled.
- Implemented server error-only 7-day log retention and relay error fields.
- Restored frontend memory/blob safety guards so P2P no longer treats browser receive/cache/download paths as unlimited.
- Recorded source-backed large-file and resumable relay target architecture.

## Verification

- PASS: `go test ./cmd/server ./internal/config ./internal/handler ./internal/middleware ./internal/model ./internal/service ./pkg/logger`
- PASS: `node --import tsx --test tests/transferReliability.test.ts`
- PASS: `npm run build`
- BLOCKED/EXISTING: `go test ./...` still fails on `server/scripts/generate-authtoken.go` because that directory is not a valid Go package.
- FAIL/EXISTING SOURCE-INSPECTION DRIFT: full `npm test` still has unrelated regex-based failures in `tests/transferFixes.test.ts`, `tests/publicRelayAuthSync.test.ts`, and `tests/serverRelaySendCompletion.test.ts`.

## Residual Work

- Implement server-owned relay chunk spool, chunk bitmap, resume query/state messages, and TTL/quota cleanup before claiming true relay断点续传.
- Add receiver-side explicit accept/save-location UI and direct-to-disk or OPFS sink before supporting 10GB P2P receives.
