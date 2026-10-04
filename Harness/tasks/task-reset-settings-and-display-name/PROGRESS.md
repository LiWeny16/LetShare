# Progress

## Status
- Phase: implementation
- User authorized ordinary audio deployment separately; that release is tracked in `task-call-public-sfu-audio`.
- Reset/name fixes are being implemented in the shared workspace while preserving all pre-existing dirty changes.

## Evidence
- Read-only investigation found `Reset All` only calls `settingsStore.reset()`; identity is separately persisted in `memorableState`.
- The existing dirty identity/meeting changes already add fun nicknames, first-meeting confirmation, and meeting-level editing. The remaining UI gap is the global Settings dialog.

## Pending
- Implement reset persistence clearing and Settings name control.
- Add AC-linked regression tests, run them red/green, then run browser acceptance.
- Review the combined diff and record evidence.
## Current status (2026-10-04; supersedes the earlier snapshot)
- Phase: implemented and locally verified; these settings/name changes were not deployed.
- Reset All clears the saved identity and all LetShare settings keys found in app storage, including room, meeting, media, preference, and relay/debug configuration. Chat history, meeting minutes, and file content remain intact.
- Fresh identity uses the existing fun nickname pool. The same display name can be changed in Settings and during first meeting entry.
- Targeted verification passed: 10/10 reset/identity unit tests and 2/2 reset/settings-name browser E2E tests.