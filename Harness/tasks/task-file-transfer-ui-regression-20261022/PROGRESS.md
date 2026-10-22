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
