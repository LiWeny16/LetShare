# task-implement-relay-resume PLAN

## Goal

Move relay transfer from a fragile live pipe toward resumable transfer by giving the server authoritative chunk state and exposing resume state to clients.

## Acceptance Criteria

- AC-001: Server records relay chunk receipt per `transfer_id` with chunk index, byte count, and a missing/received bitmap.
- AC-002: A receiver-side forwarding outage does not immediately delete chunk state; a same transfer can be inspected for missing/received chunks.
- AC-003: Server exposes a `file:transfer:resume-state` response for authorized sender/receiver clients with `received_chunks`, `missing_chunks`, `missing_count`, and transfer status.
- AC-004: Client has protocol constants/types and can request resume state for an active relay transfer without throwing on the new server message.
- AC-005: Focused tests cover server chunk ledger state, duplicate chunk accounting, and resume-state authorization.

## Non-Goals For This Slice

- Full browser direct-to-disk save UI.
- Full relay server-to-receiver replay from spool after reconnect.
- Cross-refresh P2P resume with persisted sender file handles.

## Verification

- Go focused tests for `internal/service` and `internal/handler`.
- TypeScript focused source/unit tests if client protocol code changes are testable.
- Record remaining gap to full断点续传 explicitly.

## Subagent Dispatch

- Controller handles implementation directly in this Codex environment; no native subagent runtime is currently exposed.
