# task-large-file-cache-hardening-20261023 - PROGRESS

## Status

- Phase: release verification and deployment
- Next: Commit the isolated feature branch, cherry-pick to the clean main release worktree, bump version, deploy with the standard frontend flow, and dispatch independent live online E2E agents.
- Blocker: None. Final AC-003 race fixes and independent review are complete. Existing V2 task/file-handle retention behavior is unchanged; history deletion never removes the saved disk file.

## Tasks

- [x] Create isolated worktree at release commit 79eeb54487b1033fe98367a92c9ceca0f7fcbcfa.
- [x] Record initial acceptance criteria and test gates.
- [x] Complete startup, V2 storage, and legacy/ZIP read-only audits.
- [x] Complete three independent cross-reviews and first-party pattern research; define the user-facing objective and narrow scope.
- [x] Write and run AC-linked regression tests before implementation (RED confirmed: expected policy module was absent).
- [x] Apply confirmed hydration/ZIP, V2 quota admission, and legacy relay memory fixes (three bounded writers; reviews/tests recorded).
- [x] Replace cross-tab active legacy reservation leases with same-tab shared protocol accounting plus durable V2 task accounting; preserve in-scope capacity checks.
- [x] Keep lazy hydration/startup notice fix; remove the optional aggregate ZIP expansion limit from this release scope.
- [x] Preserve existing direct-disk history handle cleanup behavior without introducing a new policy.
- [x] Complete independent UX/code review; no critical/high findings in AC-001/002/004.
- [x] Complete final local visible-browser UI smoke for the first large `offered` receive.
- [x] Fix the medium AC-003 async-admission disconnect race in relay and P2P paths.
- [x] Run the 16-file focused suite (184/184), typecheck, production build, and targeted diff check after the final fix.
- [x] Complete the independent review of the final race fixes.
- [ ] Deploy only after review passes; then run independent live online E2E as authorized by the user.

## Changes

- Implementation is underway in this isolated worktree. V2 large receives can use a user-selected direct-to-disk sink; checkpoint ACKs follow durable batch close, and final file integrity is checked before history is pinned.
- Direct-to-disk history stores metadata and a file handle rather than a duplicate payload. The agreed UI states are available/deleted/permission-required/unavailable, with an “Open file” action.
- Added storage admission, lazy received-file metadata/cache policies, and bounded legacy relay memory admission. The optional aggregate ZIP expansion cap was removed from the release scope.
- Same-page cross-protocol reservations account for V2, legacy P2P, and relay receives together. Persisted V2 task reservations are reconciled on demand; stale tokens cannot release a replacement reservation.
- Cross-review scope decision: retain same-tab shared V2/P2P/relay admission and durable V2 reservations; defer cross-tab active legacy leases/fencing because no acceptance requirement or failing user-path reproducer supports that extra layer. User requested not to overbuild.
- Final focused run: 16 transfer/storage test files, 177/177 passed; `pnpm exec tsc --noEmit` and `git -c core.whitespace=cr-at-eol diff --check` passed.
- Final `pnpm build` passed. Generated `docs/` assets in this feature worktree will be restored before source commit and regenerated on the clean release branch.
- Final independent UX/code review: AC-001/002/004 passed with no critical/high source finding. It recommends rerunning the first-offer UI flow because the prior browser run recorded the earlier invisible-offer failure.
- Final local visible-browser UI smoke passed: separate visible Edge/Chrome, local room `410824`, open P2P DataChannel, sparse 134,217,729-byte file; with the receiver drawer initially closed, the first V2 offer opened it and displayed `SAVE TO DISK`, 0 B confirmed, and server stayed connected. Evidence: `Harness/wf-browser/runs/large-file-final-ui-smoke-20261024/`.
- Independent storage review found a medium AC-003 async-admission disconnect race in both relay and P2P receive paths. Test Writer added relay runtime RED and P2P source-contract RED. A bounded implementation is in progress.
- Online deployment and production E2E are now authorized by the user, but remain gated on final source review and local/browser acceptance.
- Production remains untouched; no deploy, release, or push has occurred.

## Final AC-003 race fix (2026-10-24)

- Relay receive requests now capture a connection generation before asynchronous quota admission. A disconnect increments that generation; a stale request releases its exact reservation and is rejected before a receive session, prompt, or acceptance is created.
- The relay disconnect callback ignores a delayed old-provider event when the current provider is already connected. Stale cleanup uses captured session/reservation identities so it does not remove a same-ID receive created by a reconnect.
- P2P admission now captures the pending admission identity and rechecks that the original data channel is open and still current after storage admission. If it closed, the stale admission releases only its own reservation and creates no receive state or ready response.
- Final focused run before the same-ID follow-up: 16 transfer/storage test files, 184/184 passed. `pnpm exec tsc --noEmit`, production `pnpm build`, and targeted `git -c core.whitespace=cr-at-eol diff --check` passed.
- Relay disconnect has a runtime regression test. The P2P close-during-admission check is currently a source-contract test; a runtime P2P race simulation is not included in this release.
- Independent review then found a second bounded race: a stale same-ID relay admission could delete the replacement request's pending cache-accounting entry. A deferred runtime RED test reproduced it.
- Added a per-admission identity token; stale `finally` cleanup now removes only its own entry. The new runtime test and `legacyRelayMemoryBudget.test.ts` passed 13/13.
- Final full focused run after the token fix: 16 transfer/storage files, 185/185 passed. `pnpm exec tsc --noEmit`, production `pnpm build`, and targeted diff check passed. Independent read-only re-review found no remaining issue in the token cleanup.
- No production deploy, feature commit, or push has occurred yet; the verified source is ready for release.

## Confirmed findings

- Startup hydration and repeated ZIP alert are confirmed; hydration has deletion-race bookkeeping that must survive lazy loading.
- V2 writes every received block to IndexedDB, does not support direct-to-disk, and checks quota per block rather than against the full manifest. No proof that File construction makes a full contiguous JS heap copy.
- Legacy relay retains all chunks for files beyond 100 MiB while cache admission can allow multi-GiB payloads.
- ZIP auto-expansion limits compressed size and entry count but not aggregate bytes actually produced.
- V2 indefinite history retention was confirmed as current behavior; no policy change is authorized by evidence alone, so preserve it.
- User chose metadata-only history for V2 direct-to-disk files: keep the file handle/status, show available or deleted, and provide an Open file action. Browser permission after refresh may need a user gesture. The web File System Access API cannot open the OS file manager to reveal a parent folder, so use the selected Open file fallback.

## Verification

- Independent controller rerun: the 13-file focused transfer/storage suite passed 158/158; `pnpm exec tsc --noEmit` passed; `git diff --check` passed.
- `pnpm build` passed. Its generated `docs/` artifacts were restored/removed afterward because deployment and release artifacts are outside this task.
- The controller updated one stale static assertion in `tests/serverDirectDiskReceive.test.ts` to check the current durable-completion wrapper; the focused suite then passed.
- Independent review identified and dispatched follow-ups for IndexedDB transaction settlement, deleted-file cache invalidation, chat bubble availability refresh, and aborting direct writers before releasing Web Locks. Cross-protocol admission accounting was added afterward; an actual browser transfer remains pending.
- Independent visible-browser E2E readiness check completed. No final acceptance claim yet.
- Final reviewer identified an additional v2-to-v3 upgrade compatibility risk: a still-open older tab can block the metadata-index schema upgrade. Add `versionchange` close handling and a deterministic blocked-upgrade failure path, then re-review and verify.

## Independent visible-browser results (2026-10-23)

- **AC-001 PASS:** Edge/Chrome in room 123 received a real 22,023,581-byte ZIP, reloaded with the Download drawer closed, showed no startup notice and did not read payloads; opening the drawer restored the file list and then payload reads occurred. Evidence: `Harness/wf-browser/runs/large-file-cache-reviewer-b/` (copied from the isolated temp evidence directory after the services stopped).
- **AC-002 cache/low-quota PASS:** 360,448-byte P2P receive matched source SHA-256. With simulated 32 MiB available space, a 128 MiB + 1 byte receive was rejected before any payload/task, with 0 B confirmed and the receiver still online.
- **AC-002 direct-disk data path PASS with OPFS picker shim:** Edge/Chrome in room 123 transferred 134,217,729 bytes over accepted P2P; SHA-256 matched; V2 `blocks` and legacy `file_blobs` contained no payload, and chat history kept metadata only. Evidence: `Harness/wf-browser/runs/large-file-directdisk-reviewer-a/`.
- **AC-002 UI FAIL:** with Downloads closed, the first large incoming `offered` task and save action were invisible. Opening Downloads manually revealed “SAVE TO DISK”. A RED unit assertion now covers this.
- **AC-005 partial:** direct-disk history showed “File available” and “Open file”; the OPFS shim run opened Edge Downloads but did not prove a completed file open/download. Deleting history while Vite exited from a concurrent artifact-write `EBUSY` prevented the physical-file retention browser assertion. A separate unit test verifies metadata deletion leaves direct-disk bytes intact. Native OS save-picker UI was not tested.
- The cache/hydration validator's large ZIP was stored in `%TEMP%` rather than the watched repo; the local services are stopped. Its JSON/screenshots are copied into the evidence directory after the run.

## Final review return items

- AC-002: `shouldOpenDownloadDrawerForV2Transfer` handles first receive `receiving` but not `offered`; only the drawer exposes the disk-save action.
- AC-003: legacy relay cache admission checks memory and app retention limits but not the browser's full-file available storage estimate before accepting.
- AC-005: opening `letshare_chat_db` version 3 has no `blocked` handler or connection `versionchange` close path, so a live older tab may delay the upgrade and metadata admission.

## E2E readiness findings

- Existing `publicRelayTransfer.cdp.test.mjs` and `p2pDirectDiskPrompt.cdp.test.mjs` are headless and do not prove this V2 behavior.
- The page E2E hook exposes peer/DataChannel state, V2 snapshots, and accepted path diagnostics; the Download UI has `file-v2-save-to-disk-<transferId>`.

## Final iteration (2026-10-24)

- The prior AC-002 visibility failure predates the final correction: the first receive in `offered` status now opens the Download manager and exposes the direct-save action. Independent visible-browser smoke is running against the final source.
- Preserve the existing V2 task/file-handle cleanup behavior for this release. No new history deletion policy is introduced; removing history never deletes the user-saved physical file.
- After narrowing scope, independent focused verification passed 177/177 across 16 transfer/storage test files. `pnpm exec tsc --noEmit`, `pnpm build`, and `git -c core.whitespace=cr-at-eol diff --check` passed.
- Independent UX/code review passed AC-001/002/004 with no critical/high source findings. Independent storage/lifecycle review remains in progress.
- Independent storage/lifecycle review identified a medium stale-admission race: disconnect can happen while quota preflight is pending and the request may later create a ghost receive. The relay runtime RED reproduces no-session/no-prompt/no-accept/no-reservation expectations; the P2P contract RED covers channel-close guard and reservation release.
- Final local visible-browser offer smoke passed with real Edge/Chrome; only the pending offer UI was exercised, not native picker completion or payload transfer.
- GitHub connectivity is available through local proxy port 7897; the repository-local `http.proxy` points to inactive port 7900. The release process must override proxy configuration for its Git push.
- Production remains untouched pending final review and browser acceptance.
- Planned visible run uses separate Edge/Chrome profiles, room 123, local backend/frontend on ports 27771/27772, and CDP ports 27773/27774. Ports were free during read-only preflight.
- Direct-to-disk acceptance can use an OPFS-backed save-picker shim to exercise V2 sink/checkpoint/history behavior. Cached fallback and lazy ZIP restoration require separate quota/file-store setup and assertions beyond existing scripts.

## Notes

- Existing root worktree changes are preserved and excluded from this task.
