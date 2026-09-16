# pro-public-relay-auth-sync - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.
Link files or command names instead of pasting logs or subagent transcripts.

> Task ID: kebab-case, under 60 chars. Directory name = task ID.

## Goal

- Outcome: Fix the large-file public relay flow so a sender with PRO can reliably use the public relay for files over 50MB, without repeated invite-code prompts, and keep sender-selected transport behavior coherent.
- Non-goals: Rework the full pricing UX, redesign transfer settings, or change unrelated P2P relay reliability behavior.

## Decisions

- Use WF-style multi-agent orchestration for this task because the bug spans frontend state, connection/auth handshake, and verification.
- Treat current behavior as a regression in PRO auth-state synchronization, not as a backend size-limit policy issue.
- Make relay JWT the authoritative local PRO truth because the backend relay gate only trusts `pro_token` during the WebSocket handshake.
- Refresh custom-server auth before a >50MB public-relay send when the locally stored PRO token changed after the current socket was established.
- Do not clear stored PRO credentials on generic relay-side "upgrade to PRO" errors; those errors can be caused by stale connection auth rather than invalid activation.
- Remove silent transport fallback where sender-selected `server` priority quietly degrades to P2P, and where the P2P helper silently switches to relay.

## Acceptance

- AC-001: When a sender activates PRO and then sends a file larger than 50MB through the public relay path, the active server connection must hold valid PRO authorization and the transfer must not be blocked as Free solely due to stale connection auth state.
- AC-002: A valid stored PRO activation must persist across the send flow; a failed public-relay send must not clear local PRO credentials unless the failure proves the credentials are invalid or expired.
- AC-003: Sender transport choice must remain sender-controlled and explicit: the app may keep a fallback path, but the final behavior and user-visible status must align with the selected priority and the actual channel used.

Expanded evidence required when triggered:
- UI/browser-visible: add selector contract and real browser evidence.
- API/integration: add endpoint/payload/response contract.
- High-risk behavior: add AC-by-AC validation matrix.

## Scope

Allowed write set:
- `src/app/libs/connection/proUpgrade.ts`
- `src/app/libs/connection/providers/CustomConnectionProvider.ts`
- `src/app/libs/connection/colabLib.ts`
- `src/components/ProUpgradeDialog.tsx`
- `src/components/Settings.tsx`
- `src/pages/share.tsx`
- relevant tests under `tests/`

Forbidden:
- `server/**` unless analysis proves a backend defect is required to satisfy ACs.
- unrelated docs, deployment assets, or aesthetic-only UI changes.
- Truth files (PRD, ACs, UI/API contracts, test plan, validation report) unless a Change Request is recorded.

## Context

- Loaded: `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`, `Harness/PROGRESS.md`, `Harness/WF.md`, `Harness/subagents.md`, `Harness/dispatch.md`, `Harness/context-loading.md`, `Harness/ACCEPTANCE_PROTOCOL.md`, `Harness/TDD-GUIDE.md`, `Harness/agent-workflow.md`
- Assumptions:
  - The root bug is frontend-side auth/connection state drift between local PRO UI state and server-side WebSocket metadata.
  - Public relay capability depends on the custom WebSocket server connection, not Ably.

## Agents

Only record agents or bounded passes that materially changed the decision.

| Role | Read / Write Set | Result |
|------|------------------|--------|
| controller | task capsule only | created task capsule and dispatch plan |
| explorer-auth | read `src/app/libs/connection/**`, `src/components/**`, `server/internal/**`; write none | found root cause: frontend `isPro()` accepted invite-code cookie but backend relay gate trusted only handshake-time `pro_token`; custom socket stayed stale after activation |
| explorer-transport | read `src/pages/share.tsx`, `src/app/libs/connection/**`, i18n/settings files; write none | found sender `server` priority still fell back to P2P in page flow, and library P2P send helper silently fell back to relay |
| explorer-tests | read `tests/**`, affected source files; write none | proposed focused regression coverage for auth sync, credential persistence, and transport selection |
| worker-auth | write `src/app/libs/connection/proUpgrade.ts`, `src/app/libs/connection/colabLib.ts`, `src/components/ProUpgradeDialog.tsx`, focused tests | completed token-authoritative PRO state, custom relay auth resync, and no-credential-wipe behavior |
| worker-transport | write `src/pages/share.tsx`, focused tests for sender transport behavior | completed explicit sender transport behavior and added regression coverage |
| reviewer-gpt55-xhigh | read critical PRO/public-relay/auth-sync and sender transport files only; write none | PASS_WITH_CONCERNS: custom public relay path satisfies ACs; provider-mode contract for Ably/global remains a medium concern if product expects it to be a usable public relay |

## Verification

- [x] Reproduce logic path with targeted unit/integration evidence
- [x] Run affected frontend tests
- [x] Run focused backend size-limit test or note why unchanged
- [x] Produce AC-by-AC validation summary

## Risks

- Reconnecting the custom server after activation could disrupt current room/presence behavior if not done carefully.
- Persisted PRO state currently mixes invite-code cookie and JWT token; tightening invalidation may expose latent edge cases.
- Transport-selection semantics may need a product decision if the current fallback behavior is intentionally retained.
- Reviewer concern: current auth refresh is intentionally scoped to the `custom` provider because backend binary relay auth is custom WebSocket based. If `server` priority must also mean usable public relay while connected through Ably/global provider mode, add an explicit provider-mode contract and test.
- Reviewer concern: `isPro()` is token-presence based; expired/invalid token UX still needs a product/security decision outside this bugfix.

## Expanded Contracts

### UI Contract

| Element | Selector / Role | States | AC IDs |
|---------|-----------------|--------|--------|
| PRO badge / dialog | settings PRO badge and activation dialog | Free, activating, activated | AC-001, AC-002 |
| transport preference | settings transfer priority radio group | `p2p`, `server` | AC-003 |

### API Contract

| Endpoint | Method | Payload / Response | AC IDs |
|----------|--------|--------------------|--------|
| `/api/pro/activate` | POST | `{ user_id, invite_code } -> { token, expires_at }` | AC-001, AC-002 |
| WebSocket handshake | GET query params | `token`, `userId`, optional `pro_token` | AC-001 |

### Validation Matrix

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | PASS | `tests/publicRelayAuthSync.test.ts`, `go test ./internal/service -run TestCreateTransferSession -v` | large relay sends now refresh custom relay auth when the stored PRO token changed after socket creation |
| AC-002 | PASS | `tests/publicRelayAuthSync.test.ts` | valid local PRO activation is no longer invalidated by generic relay upgrade-required errors |
| AC-003 | PASS | `tests/shareTransportPriority.test.ts` | sender-selected `server` priority no longer silently degrades to P2P; helper no longer silently switches channels |

### Focused Review Result

| Reviewer | Verdict | Findings |
|----------|---------|----------|
| `gpt-5.5/xhigh` focused reviewer | PASS_WITH_CONCERNS | No blocking/high findings for custom public relay. Medium concern remains around provider-mode definition for Ably/global, plus missing behavior-level tests beyond source-shape regression guards. |
