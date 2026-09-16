# task-review-relay-resume - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.

> Task ID: task-review-relay-resume

## Goal

- Outcome: Review the current relay file-transfer design and identify the best architecture for tolerating network interruption and supporting resumable transfers.
- Non-goals: Implement the redesign, deploy production changes, or change Android-specific behavior.

## Decisions

- Use WF-Full bounded role passes because the task is cross-layer, architecture-heavy, and has data-loss / transfer-completion risk.
- Treat the current stale websocket fix as a necessary tactical patch, not a resumable-transfer architecture.
- Prefer an incremental migration plan that can first harden the existing WebSocket relay and then add server-side temporary chunk spooling.

## Acceptance

- AC-001: Existing sender, receiver, and relay server code paths are reviewed with file/line evidence for why a transient network fault becomes terminal.
- AC-002: A recommended relay architecture is documented with state ownership, protocol messages, persistence boundaries, and migration phases.
- AC-003: Verification and review gates identify tests needed before implementation, including reconnect, duplicate chunk, missing chunk, and receiver resume cases.

## Scope

Allowed write set:
- `Harness/tasks/task-review-relay-resume/**`
- `Harness/PROGRESS.md`

Forbidden:
- Production frontend or backend code in this review-only pass.
- Deployment artifacts.
- Truth files outside this task capsule unless a Change Request is recorded.

## Context

- Loaded: `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`, `Harness/PROGRESS.md`, `Harness/specs/workflows/WF.md`, `Harness/specs/workflows/WF-KERNEL.md`, `Harness/specs/runtime/subagents.md`, `Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md`, `Harness/specs/runtime/agent-workflow.md`, `memory/server-relay-stale-client-reset.md`, `memory/server-relay-complete-before-end.md`.
- Assumptions: The latest user report is about relay transfers failing on interruption and not supporting resume, not about Android packaging.

## Agents

Only record agents or bounded passes that materially changed the decision.

| Role | Read / Write Set | Result |
|------|------------------|--------|
| Planner bounded pass | Harness WF docs, project memory / task state only | WF-Full review with no production writes in this pass. |
| Frontend codebase explorer | `ServerFileTransfer`, providers, chat persistence / none | Current disconnect path is terminal and all partial transfer state is volatile. |
| Backend codebase explorer | relay service, websocket handler, session model / none | Server is live relay only; no chunk ledger, bitmap, checksum, or resume protocol. |
| Test-writer bounded pass | existing frontend/backend relay tests / none | Tests cover tactical ACK/resend/disconnect cases but not reconnect resume. |
| Architect bounded pass | relay protocol/state ownership / review artifact | Recommend server-coordinated resumable job with temporary chunk spool. |
| Reviewer bounded pass | architecture recommendation and evidence / none | PASS with high-priority Phase 0 hotfix finding. |
| Verifier bounded pass | line evidence and task artifacts / none | PASS for review evidence; production tests not all green due existing drift. |
| Reflector bounded pass | final risks and readiness / none | PASS for review-only acceptance; implementation needs new RED tests first. |

## Verification

- [x] `rg` evidence for relay control/data protocol and state transitions.
- [x] Existing tests reviewed for coverage gaps.
- [x] Architecture review artifact written and cross-checked against ACs.

## Risks

- Browser refresh cannot resume from the original `File` object unless the app stores a copy in OPFS/IndexedDB or asks the sender to reselect the same file.
- Server-side spooling changes cost, quota, cleanup, and security boundaries; it should be introduced behind TTL and per-user limits.

## Expanded Contracts

### API Contract

| Endpoint | Method | Payload / Response | AC IDs |
|----------|--------|--------------------|--------|
| WebSocket relay control | WS | Transfer manifest, resume query/state, ACK bitmap, error/cancel/complete messages must be idempotent by `transfer_id`. | AC-001, AC-002 |
| Relay chunk data | WS or HTTP | Chunks must be addressable by transfer, file, chunk index, and hash; duplicates are accepted as idempotent no-ops. | AC-002, AC-003 |

### Validation Matrix

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | PASS | `Harness/tasks/task-review-relay-resume/RELAY_RESUME_REVIEW.md#Current-Flow-Evidence` | Existing terminal-failure paths cited with frontend/backend file lines. |
| AC-002 | PASS | `Harness/tasks/task-review-relay-resume/RELAY_RESUME_REVIEW.md#Recommended-Architecture` | Recommended state ownership, protocol messages, chunk store, and migration phases documented. |
| AC-003 | PASS | `Harness/tasks/task-review-relay-resume/RELAY_RESUME_REVIEW.md#Test-Plan` | Missing reconnect/resume/idempotency/TTL tests listed before implementation. |
