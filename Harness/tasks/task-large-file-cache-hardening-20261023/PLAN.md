# task-large-file-cache-hardening-20261023 - PLAN

## Goal

- Outcome: Stop old received ZIPs from being eagerly restored with a stale startup notice; keep existing transfer progress and ordinary-file UX; stream eligible large V2 receives directly to a user-selected file; preflight cached fallback receives and bound legacy relay buffering; keep direct-disk history metadata-only with availability and Open file actions.
- Non-goals: Redesign ordinary small-file transfers, add settings or new choices beyond the browser's required save picker, guarantee direct-to-disk on browsers without that API, coordinate active legacy receives across separate tabs, change unrelated meeting/audio/chat behavior, or delete a user-saved disk file when its LetShare history is removed.

## Decisions

- Use an isolated worktree from release commit `79eeb54487b1033fe98367a92c9ceca0f7fcbcfa`.
- Start with three independent read-only audits. Only evidence-confirmed defects enter the write set.
- Keep browser storage fallback for browsers without a direct-save API; require full-file quota admission before accepting. Preserve direct-to-disk for supported desktop clients.
- Do not change indefinite chat-history retention unless reviewers prove it creates a user-data/storage defect and identify a safe, non-destructive policy.
- Use one receive action on the direct-disk path so the required user gesture opens the save picker; do not add a separate acceptance step.
- Use same-tab shared reservations across V2, legacy P2P, and relay receives, plus durable V2 task accounting. Defer cross-tab active legacy reservation leases unless evidence shows they are required.
- Direct-disk history keeps metadata and a file handle, not a duplicate payload; opening the item is user-initiated. Removing history must not remove the saved disk file. This release preserves the existing task/handle retention behavior and does not introduce a new cleanup policy.
- User now explicitly authorized deployment after the final fixes and verification. Use the repository's standard `node scripts/deploy.cjs --frontend` release flow; do not deploy before review and E2E gates pass.

## Acceptance

- AC-001: With Downloads closed on reload, persisted file payloads are not hydrated and the old ZIP notice does not appear. Opening Downloads restores the same rows and only then hydrates cached payloads.
- AC-002: For V2 receives above the current direct-save threshold, eligible desktop browsers can save via a single user-initiated picker action. Received blocks are integrity-checked before durable writes/checkpoints; progress stays visible; the complete payload is not retained in IndexedDB.
- AC-003: On browsers using cached storage, V2 checks the full manifest before accepting. Same-tab concurrent V2/legacy P2P/relay admissions share one capacity budget. Legacy relay memory is bounded; when no supported path has enough capacity, the request is rejected before payload reception. Runtime quota errors remain recoverable. If a transport drops during asynchronous admission, discard the stale request, release its reservation, and create no receive session or acceptance.
- AC-004: Direct-disk history stores no payload duplicate, reports available/deleted/permission-required/unavailable, and offers Open file. History removal never deletes the saved disk file; existing task/handle retention behavior is unchanged.
- AC-005: Relevant Chat IndexedDB upgrades fail cleanly rather than silently hanging. After all code and review gates pass, the frontend is deployed with the standard script and independent agents verify online small-file and large-file P2P flows, progress, save, and history.

## Scope

Allowed write set (finalized after cross-review):
- Relevant file-transfer and Download UI source files.
- AC-linked regression tests and E2E test artifacts only.
- This task's PLAN/PROGRESS/REFERENCES.
- Release version/build artifacts needed by `node scripts/deploy.cjs --frontend`.

Forbidden:
- Deploying before the agreed source, review, and E2E gates pass.
- Files in the root `rewrite/core-v2` worktree.
- Unrelated UI/meeting/audio refactors.
- Weakening or deleting existing tests to get green.

## Context

- Loaded: `CLAUDE.md`; subagent-orchestrator skill; Harness subagent, dispatch, context-loading, workflow, isolation, acceptance, bridge, and TDD instructions; LetShare file-message memory.
- Assumption: The release worktree is the production source of truth for this fix; the user's other working tree contains unrelated uncommitted changes.

## Agents

| Role | Read / Write Set | Result |
|------|------------------|--------|
| Planner | Read-only | AC and phases drafted; direct-save/recovery tradeoff flagged |
| Startup/hydration reviewer | Read-only: Download/share/colabLib/history storage | Completed; findings and corrections recorded below |
| V2 storage reviewer | Read-only: V2 protocol/store/engine/adapter/routing | Completed; findings and corrections recorded below |
| Legacy/ZIP reviewer | Read-only: legacy P2P/relay/cache/ZIP | Completed; final async-admission race independently reviewed after correction |
| Test writer / implementer / independent E2E validators | Bounded regression and validation write sets | Local regression/UI evidence complete; live E2E agents to run after deployment |

## Confirmed audit evidence (release baseline)

- **AC-001 confirmed:** `DownloadDrawer` mounts while closed and hydrates stored files on mount; persisted ZIP restoration calls auto-unzip and can replay the large-ZIP toast. The hydration effect also has deletion/hydration race guards that must remain correct when made lazy.
- **AC-002 confirmed:** V2 commits every accepted block to IndexedDB, has no disk sink, and checks only current usage plus the next block. It can begin a transfer that later pauses when quota runs out. A V2 disk sink must preserve hash-before-write/checkpoint-after-write ordering; cross-reload handle recovery is a separate constraint.
- **AC-003 confirmed:** the legacy server relay can retain all chunks in memory for files above its 100 MiB assembly threshold while the retained-file cache guard permits much larger files. Mobile legacy P2P direct-save fallback may abort when the browser lacks the desktop picker; keep this distinct from V2 behavior and confirm the smallest safe correction before changing routing.
- **AC-004 confirmed:** auto-unzip caps compressed input at 20 MiB and entry count at 40, but does not cap aggregate uncompressed output or actual bytes emitted.
- History retention is pinned indefinitely in V2; the audit did not establish a safe replacement policy, so retention semantics remain out of scope.

## User decision for V2 disk history

- For direct-to-disk receives, retain only the file handle and history metadata rather than an IndexedDB copy of the payload.
- Show the file as available while its saved handle is readable; show deleted when the handle reports `NotFoundError`; treat revoked/prompt permissions separately and request them from a user action.
- Offer an “Open file” action. A browser page cannot reliably open Explorer/Finder and reveal the containing folder through the standard File System Access APIs.

## Verification

- [x] Confirm startup alert, quota/storage, direct-save, history, and migration behavior with AC-linked tests.
- [x] Run focused transfer/storage suite, typecheck, and production build.
- [x] Run independent real-browser Chrome + Edge local acceptance and capture evidence.
- [x] Complete independent review of the final AC-003 disconnect-race fix.
- [ ] Deploy with the standard frontend release flow after the review passes.
- [ ] Dispatch independent agents to verify live small-file and large-file P2P transfer, progress, saved-file integrity, history, and peer connectivity.

## Risks

- V2 direct-to-disk changes the receive storage contract and may affect resume after reload; keep this limitation explicit and verify no duplicate or corrupt writes.
- `navigator.storage.estimate()` is advisory; concurrent browser writes can still cause a later QuotaExceededError, so retain a paused/recovery path.
