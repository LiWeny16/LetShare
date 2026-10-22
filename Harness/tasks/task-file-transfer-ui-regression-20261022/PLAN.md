# File transfer receive UI regression

## Mini PRD

- **Goal:** Restore the familiar file-transfer manager flow on both sender and receiver, keep live progress visible, and prevent repeated/same-name files from overwriting one another.
- **Scope:** File Transfer V2 sender and receiver UI, received-file identity for V2 and legacy fallback, and displayed status/filenames.
- **Non-scope:** Browser-native download policy, transfer protocol, and persistence format unless review finds a concrete encoding/identity defect that requires a minimal correction.
- **User flow:** When a transfer starts, the initiating sender and receiving peer see the LetShare transfer manager with ongoing progress. On completion, the file is available through the established received-files/download behavior. Sending the same file again is a distinct user-requested transfer unless the product already has an explicit duplicate-confirmation flow.
- **State changes:** Active sender and receiver tasks stay visible while transferring or recoverable. Completed items must not silently disappear from a user's expected download/history path. Transfer identity must distinguish separate sends even when names or contents match.

## Acceptance criteria

### AC-001: Incoming V2 transfer opens the LetShare download drawer

Given the recipient has LetShare open and a peer starts a new V2 file transfer,
when the receiver enters `receiving`,
        then the LetShare download drawer opens once and shows the active transfer and its progress;
repeated progress updates do not reopen a drawer the user closed.

### AC-003: Outgoing V2 transfer shows live progress

Given the sender starts a new V2 file transfer,
when the sender enters an active sending state,
then the LetShare download/transfer manager opens once and keeps the active task and progress visible through completion or failure.

### AC-002: Completed receives remain separately addressable

Given a V2 or legacy file finishes and is committed to chat history,
when the recipient opens the download drawer,
then the completed task is absent from the active transfer area,
and the received file appears in the existing received-files area and remains downloadable. Two transfers from the same peer with the same filename remain separately addressable; bulk download gives duplicate names distinct archive names, and deleting one removes only its matching history item.

## UI/state contract

| Element/state | Contract | AC |
|---|---|---|
| Download drawer | Opens on the first receiving snapshot for a new incoming V2 task. | AC-001 |
| Download drawer | Opens on the first active sending snapshot for a new outgoing V2 task. | AC-003 |
| Active transfer area | Shows non-completed V2 tasks only; absent when empty. | AC-001, AC-002 |
| Received-files area | Includes completed V2 or legacy files and retains the existing download action. | AC-002 |
| Durable V2 task | Remains stored and linked to chat history for recovery/deletion. | AC-002 |
| Repeated send | Each explicit V2 send has an independent transfer ID, including same-name or same-content files; no silent content deduplication. | AC-002 |
| Legacy receive identity | Use its persisted file key so same-name receives from one peer do not overwrite each other's received-file entry. | AC-002 |
| Filename display | Preserve the sender-provided filename's Unicode text from transfer metadata through the received-file UI. | AC-002 |
| Chinese status | Remote-paused status text renders as readable Chinese. | AC-001, AC-003 |

## Verification plan

- Regression unit test for opening only once on the first incoming `receiving` and outgoing `preparing` snapshot.
- Regression unit test for hiding completed tasks while retaining active and recoverable tasks.
- Regression unit test for same-name V2 and legacy receive identities and collision-free bulk archive names.
- Browser acceptance: receive a small file through the real V2 path, observe drawer opening and progress, then verify the completed transfer row disappears while the file is available once in received files and its download has the expected name, byte count, and SHA-256.
- Browser acceptance: send a small file through the real V2 path and verify the sender also sees the manager open with continuously updating progress; separately send same-name and same-content files and verify neither silently overwrites the other, both can be downloaded/deleted independently, and Unicode filenames render correctly.
- Browser acceptance: exercise remote pause and verify its Chinese status text is readable.
- Build the frontend and run the targeted regression tests.

## Cross-review dispatch

| ID | Role | Objective | Mode | Read set | Write set | Status |
|---|---|---|---|---|---|---|
| UX-01 | Product/interaction reviewer | Determine the lowest-friction familiar sender/receiver flow from user reports and established UI behavior; assess completed-row handling and repeat-send expectations. | Read-only | This PLAN/PROGRESS, file-message PRD, `Download.tsx`, legacy transfer flow | none | Returned |
| CODE-01 | Frontend code reviewer | Trace V2 sender/receiver status snapshots, drawer opening, active progress visibility, transfer identity, and filename encoding; report concrete defects. | Read-only | Current diff, V2 presentation/engine integration, `Download.tsx`, transfer tests | none | Returned |
| AC-01 | Independent acceptance reviewer | Compare current tests/build/deployed evidence to the user-observable requirements, including sender visibility, receiver visibility, duplicate sends, and Unicode names; identify what remains unverified. | Read-only | This PLAN/PROGRESS, current diff, tests, deploy/version evidence | none | Returned |
