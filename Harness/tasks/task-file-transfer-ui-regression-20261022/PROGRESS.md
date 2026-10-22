# Progress

## Root cause

- Legacy incoming P2P metadata calls `setDownloadPageState(true)`. The File Transfer V2 update callback only emits a snapshot and refreshes the app UI, so the receive drawer never opens for V2 transfers.
- V2 completed tasks are pinned with their chat history. `DownloadDrawerSlide` displayed every unexpired task in the transfer area and filtered those files out of the established received-files area, making completed transfers appear as persistent cards.
- The browser download itself remains a user click on the existing Download action; the missing popup was LetShare's own drawer.

## Implementation

- On the first `receiving` snapshot for a new incoming task, open the LetShare drawer once. Repeated chunk updates do not reopen it.
- Hide completed V2 tasks from the active transfer area and include their completed files in the existing received-files area.
- Key V2 received files by their durable transfer ID so same-name files from one peer remain individually downloadable and deletable; disambiguate duplicate filenames inside bulk-download ZIPs.
- Durable V2 tasks and chat history remain intact for resume, download, and deletion.

## Verification

| AC | Result | Evidence |
|---|---|---|
| AC-001 | PASS (logic) | `tests/fileTransferV2Presentation.test.ts`: first incoming receive opens; repeated receiving, resumed/reconnecting state, sender, and completed status do not reopen. Browser transfer validation pending. |
| AC-002 | PASS (logic/build) | Same test confirms completed rows are hidden while receiving, reconnecting, paused, needs-source, and failed remain visible. `npm run build` completed as 3.8.50. Browser rendering/download validation pending. |

RED/GREEN: the new test first failed because the presentation contract module did not exist; after implementing the helpers and wiring them into the app, targeted tests passed (68 tests across V2 presentation, integration, and engine suites).

`git diff --check` passed. The build emitted the existing Vite native-loader warning, chunk-size warnings, and a cleanup script abort-check that restored one referenced worker chunk; the build completed successfully.

## User follow-up and cross-review (2026-10-22)

- User confirmed the expected familiar flow includes sender progress: opening the LetShare transfer manager during outgoing as well as incoming transfers is reasonable and desirable.
- Three independent Luna Max read-only reviews agree: receiver V2 currently opens on first `receiving`; sender V2 does not open (AC-003 fail); active snapshots still contain progress and render when the drawer is open. Completed rows leave the active area but files remain in received/sent history.
- V2 creates a fresh random transfer ID per explicit send. SHA-256 verifies content integrity and is not used for deduplication. Same-name/same-content V2 sends remain separate; legacy received-file map keys were filename-only and could overwrite same-name entries in memory.
- Review found the screenshot's likely pause chip source: the Chinese remote-paused status literal in `Download.tsx` is mojibake and predates `a6fd36d`. V2 filename metadata itself follows `File.name` through JSON/UTF-8 and direct UI rendering; the first point of filename corruption remains unverified without an end-to-end code-point comparison.
- Review found a separate same-name concurrent outgoing chat-placeholder correlation risk: `file-sent` carries `transferId`, but `ChatIntegration` currently discards it and matches the newest uploading message by filename. It does not affect V2 transfer-manager row identity; defer unless browser acceptance shows user-visible corruption in this task.
- Accepted design: open the manager once on initial outgoing `preparing` and incoming `receiving`; do not reopen after the user closes it; show active/recoverable tasks; move completed items to existing received/sent history; never silently deduplicate a user-requested send; key legacy received entries by their persisted file key.
- Implementation now changes the V2 drawer-open predicate for sends, uses persisted identity for legacy received-file rows, and fixes the remote-paused Chinese label. Added tests cover sender auto-open and same-name legacy identity. The first red run failed on the missing exported predicate as expected; the updated targeted suite passes 5/5.
- Final cross-review: independent reviewers found no reproducible same-name history/blob overwrite or ZIP child-key collision. The sender drawer opens on the first V2 `preparing` snapshot; the existing progress snapshots and drawer rendering remain in place. Unicode filename handling has no lossy conversion in the traced V2 path; real-browser filename acceptance remains unverified.
- Final verification: 179 focused file-transfer tests passed; `pnpm exec tsc --noEmit`, `git diff --check`, and `npm run build` passed. Build emitted the existing Vite config/chunk warnings and cleanup abort-check warning, then generated version 3.8.51.
- Deployment: source fix committed as `a9d3f21`; the deploy script uploaded `docs/` to ECS and origin returned 200. Docs artifact sync committed and pushed as `58bb735`. A direct retry without the configured GitHub proxy completed the push. CDN credentials were unavailable, so the deploy script skipped explicit CDN refresh; post-deploy public checks nevertheless returned root 200, `version.json` 200 with version 3.8.51, and the public `share` bundle 200 containing the corrected Chinese pause label.
- Browser acceptance remains pending: the existing relay CDP test did not validate the sender UI because its harness disables `RTCPeerConnection`; it failed the sender progress assertion before providing meaningful two-peer transfer evidence. No real two-peer transfer or Unicode filename download is claimed as browser-verified.
