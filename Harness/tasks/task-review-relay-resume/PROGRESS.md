# task-review-relay-resume - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Closed
- Next: Open a follow-up implementation task for Phase 0 hotfix tests/fix.
- Blocker: none

## Tasks

- [x] Define goal and scope
- [x] Create WF task capsule
- [x] Trace current relay sender/receiver/server data flow
- [x] Identify terminal-failure root causes and resume gaps
- [x] Document recommended architecture and migration plan
- [x] Cross-review and reflector pass

## Changes

- Added review-only WF task capsule for resumable relay architecture.
- Added `RELAY_RESUME_REVIEW.md` with evidence, recommended architecture, migration phases, and test plan.

## Verification

- PASS: `C:\Program Files\Go\bin\go.exe test ./internal/service -run TestForwardChunkToReceiverRebindsClosedAcceptedClient -count=1 -v`
- PASS: `C:\Program Files\Go\bin\go.exe test ./internal/handler -run TestNotifyTransferErrorBypassesGenericRateLimiter -count=1 -v`
- FAIL, existing source-inspection drift: `node --import tsx --test tests/serverRelaySendCompletion.test.ts` failed 2 tests unrelated to this review-only task.

## Notes

- User reports the current relay path is effectively guaranteed to fail under small network disturbance and cannot resume.
- Review conclusion: current relay is a live WebSocket pipe. True resume needs server-owned transfer jobs plus temporary chunk spooling; client-side resend alone is insufficient.
- High-priority Phase 0 finding: stale socket removal can trigger normal disconnect cleanup and mark a transfer `error`, so rebind must not terminalize the logical transfer when a newer same-user socket exists.
