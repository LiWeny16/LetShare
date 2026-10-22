# File transfer receive UI regression

## Mini PRD

- **Goal:** Restore the familiar receive flow while keeping resumable transfer state out of the completed-file list.
- **Scope:** Incoming File Transfer V2 UI in the LetShare download drawer.
- **Non-scope:** Browser-native download policy, transfer protocol, persistence format, and legacy transfer behavior.
- **User flow:** A peer sends a file; the recipient's LetShare download drawer opens while receiving; progress remains visible; after completion the file appears once in the existing received-files list and can still be downloaded.
- **State changes:** The incoming V2 task remains durable for recovery and chat history, but a completed task is not shown in the active task area.

## Acceptance criteria

### AC-001: Incoming V2 transfer opens the LetShare download drawer

Given the recipient has LetShare open and a peer starts a new V2 file transfer,
when the receiver enters `receiving`,
then the LetShare download drawer opens once and shows the active transfer;
repeated progress updates do not reopen a drawer the user closed.

### AC-002: Completed V2 files do not accumulate as transfer cards

Given a V2 file finishes and is committed to chat history,
when the recipient opens the download drawer,
then the completed task is absent from the active transfer area,
and the received file appears once in the existing received-files area and remains downloadable. Two V2 files from the same peer with the same filename remain separate; bulk download gives them distinct archive names, and deleting one removes only its matching history item.

## UI/state contract

| Element/state | Contract | AC |
|---|---|---|
| Download drawer | Opens on the first receiving snapshot for a new incoming V2 task. | AC-001 |
| Active transfer area | Shows non-completed V2 tasks only; absent when empty. | AC-001, AC-002 |
| Received-files area | Includes completed V2 files once and retains the existing download action. | AC-002 |
| Durable V2 task | Remains stored and linked to chat history for recovery/deletion. | AC-002 |

## Verification plan

- Regression unit test for opening only once on the first incoming `receiving` snapshot.
- Regression unit test for hiding completed tasks while retaining active and recoverable tasks.
- Regression unit test for same-name V2 identity and collision-free bulk archive names.
- Browser acceptance: receive a small file through the real V2 path, observe drawer opening and progress, then verify the completed transfer row disappears while the file is available once in received files and its download has the expected name, byte count, and SHA-256.
- Build the frontend and run the targeted regression tests.
