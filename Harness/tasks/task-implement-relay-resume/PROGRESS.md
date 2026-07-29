# task-implement-relay-resume PROGRESS

## Status

- Phase: Implementing
- Started: 2026-07-27T16:05:00+08:00

## Heartbeat

- Created follow-up task because the persisted goal still requires actual断点续传 behavior beyond Phase 0.
- Current slice targets server-owned chunk ledger/resume-state protocol before full replay.
- Implemented server chunk ledger/spool, interrupted session state, resume-state query, and receiver missing-chunk replay from relay spool.
- Verified Go service/handler packages and frontend build. Full frontend test suite still has pre-existing source-inspection assertion drift unrelated to this slice.

## Log

- Active task opened and ACs scoped to the smallest useful resumable relay foundation.
- Added `file:transfer:resume-query` / `file:transfer:resume-state`.
- Relay chunks are recorded before receiver writes, with duplicate chunk accounting and hashed temp spool paths.
- Receiver disconnect/write failures now mark active transfers `interrupted` and return resume state instead of terminal `file:transfer:error` + 5s removal.
- Receiver `file:transfer:resend` first replays available chunks from server spool, forwarding only missing spool chunks back to sender.
- Added Go coverage for ledger state, unauthorized resume query, interrupted disconnect retention, and spool replay.
- Added frontend protocol coverage for resume-state handler wiring.
