# Visible browser acceptance: direct disk

Date: 2026-10-23 (Asia/Shanghai)

## Environment

- Visible Edge 155.0.4283.62 and Chrome 155.0.8059.86, separate processes and temporary profiles.
- Local backend/frontend on ports 27771/27772; CDP ports 27773/27774.
- Room 123. Sender `chrome:room123`; receiver `edge:room123`.
- 134,217,729-byte file; sender and receiver SHA-256 both `256488d1ec11964596f42c83d7255fb6c501ef2afe47fec56e550d73cdfee78f`.
- Receiver used an OPFS-backed `showSaveFilePicker` shim. This validates the V2 direct disk sink and storage behavior, not the native OS save-picker UI.

## Results

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-002: P2P V2 direct disk receive and integrity | PASS with OPFS picker shim | `direct-transfer.json`; receiver completed 134,217,729 bytes, accepted path `p2p`, receiver OPFS size/hash matched sender and manifest. |
| AC-002: Do not persist payload blocks in IndexedDB | PASS | V2 `blocks` store count 0; `file_blobs` count 0; chat history kept only metadata with `storageMode: direct-to-disk`. |
| First incoming V2 offer shows a download action with Downloads drawer closed | FAIL | `edge-current.png` shows connected receiver home without offer/action. After manually opening `+` > `下载管理`, `edge-downloads-manual.png` shows the incoming offer and `SAVE TO DISK`. |
| Direct-disk chat history and “Open file” control | PARTIAL | `edge-chat-history.png` shows “File available” and “Open file”. Clicking the control opened Edge's downloads hub, but no completed download was found in the profile or test output; actual open/download result is not proven. |
| AC-005: delete history metadata while physical disk file remains | BLOCKED | The chat trash action was clicked, then the app renderer stopped responding to CDP. No confirmation dialog appeared. Vite also exited after a Windows `EBUSY` watch error while another parallel validator wrote a ZIP artifact; a fresh page got `ERR_CONNECTION_REFUSED`. No post-delete IndexedDB/OPFS check was possible. |

## Cleanup

- Stopped the local Go backend and the Edge/Chrome processes started for this run. The local Vite process had already exited with `EBUSY`.
- No production site, deployment, or repository source file was touched by this validator.
