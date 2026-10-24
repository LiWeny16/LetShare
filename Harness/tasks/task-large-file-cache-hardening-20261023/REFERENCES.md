# Research references

Checked 2026-10-24. This research informs the objective and UX/storage choices; it does not imply a guarantee of 100% transfer success.

## MDN — `Window.showSaveFilePicker()`
- URL: https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
- Source type: official
- Version: MDN page checked 2026-10-24
- License: CC BY-SA 2.5 (documentation)
- Decision: adapt
- Reason: The picker has limited browser availability, requires a secure context and transient user activation. Keep it feature-detected and invoke it from the existing user action; do not force it on every browser.
- AC IDs: AC-002
- Checked at: 2026-10-24

## Chrome for Developers — File System Access API
- URL: https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- Source type: official
- Version: documentation checked 2026-10-24
- License: CC BY 4.0 (documentation)
- Decision: adapt
- Reason: Documents streamed file writes, permission/user-gesture boundaries, and a normal `<a download>` fallback. Use the progressive-enhancement shape; retain LetShare's own quota preflight for P2P data.
- AC IDs: AC-002, AC-003
- Checked at: 2026-10-24

## MDN — Origin private file system
- URL: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- Source type: official
- Version: MDN page checked 2026-10-24
- License: CC BY-SA 2.5 (documentation)
- Decision: adapt
- Reason: OPFS is private to the origin, not user-visible, quota-limited, and cleared with site data. Treat it as browser storage, not as the user's selected saved file.
- AC IDs: AC-002, AC-004
- Checked at: 2026-10-24

## PairDrop — project README
- URL: https://github.com/schlagmichdoch/PairDrop
- Source type: author
- Version: master branch checked 2026-10-24
- License: GPL-3.0
- Decision: adapt
- Reason: The comparable browser P2P app documents one receive-accept flow, automatic browser download when possible, overall multi-file progress, and mobile share options. Adopt the familiar flow and progress cues; do not assume its storage behavior meets LetShare's large-file goals.
- AC IDs: AC-002, AC-005
- Checked at: 2026-10-24

## PairDrop — receive implementation
- URL: https://raw.githubusercontent.com/schlagmichdoch/PairDrop/master/public/scripts/network.js
- Source type: author
- Version: master branch checked 2026-10-24
- License: GPL-3.0
- Decision: reject
- Reason: The receive code collects chunks in an array, creates a Blob, then a File. That implementation is not a suitable large-file memory strategy for LetShare.
- AC IDs: AC-002
- Checked at: 2026-10-24

## GoogleChromeLabs — browser-fs-access
- URL: https://github.com/GoogleChromeLabs/browser-fs-access
- Source type: author
- Version: main branch checked 2026-10-24
- License: Apache-2.0
- Decision: adapt
- Reason: Feature-detect the File System Access API and use the browser download fallback where unavailable; the fallback does not provide direct-disk history handles.
- AC IDs: AC-002
- Checked at: 2026-10-24

## MDN — Storage quotas and eviction criteria
- URL: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Source type: official
- Version: MDN page checked 2026-10-24
- License: CC BY-SA 2.5 (documentation)
- Decision: adopt
- Reason: Browser storage quota estimates are approximate and writes may still fail. Preflight before acceptance, but keep a recoverable quota-error path.
- AC IDs: AC-003
- Checked at: 2026-10-24
