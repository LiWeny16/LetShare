# task-improve-relay-resilience PLAN

## Goal

Improve relay transfer tolerance so a temporary network reset does not immediately destroy the logical transfer, add server-side error evidence for relay failures, and document the correct large-file architecture for P2P/relay resume.

## Acceptance Criteria

- AC-001: Relay forwarding can rebind from a closed accepted receiver websocket to a newer same-user websocket without marking the transfer session `error`.
- AC-002: Server relay/file-transfer error logs include investigation keys: `transfer_id`, operation/stage, involved client/user IDs where available, and the concrete write/forward reason.
- AC-003: Server file log retention writes only `level:error` entries to `logs/errors.log` and cleanup retains only the last 7 days.
- AC-004: The 10GB P2P browser-space failure is traced to the browser receive/cache path, with a source-backed architecture for direct-to-disk or OPFS streaming and resumable chunk tracking.
- AC-005: Focused backend tests cover stale socket rebind with disconnect callback enabled and logger retention behavior.

## Scope

- Backend relay hotfixes and tests are in scope for this iteration.
- Full server chunk spooling and full browser direct-to-disk receive implementation are architecture follow-up unless the codebase already has a low-risk extension point.

## Verification

- Run focused Go tests for `server/internal/service`.
- Run logger package tests after adding retention coverage.
- Record external browser-storage/WebRTC evidence in the task artifact.
