# Reset All Settings and Display Name — Mini PRD

## Goal

Make Reset All Settings remove persisted LetShare configuration and the old local identity, use the existing fun nickname pool for a newly initialized user, and let users edit the same display name from global settings and before their first meeting.

## Scope

- Clear LetShare's persisted local settings and identity (`user_settings`, `memorableState`, saved PayNow form values, and call/transport overrides) on Reset All, then reload with defaults and a newly initialized identity.
- Keep the existing curated nickname pool and first-meeting name confirmation behavior.
- Add an edit-name control to the global Settings dialog, using the existing identity update path so the name appears in ordinary rooms and meetings.
- Preserve persisted user content such as chat history, meeting minutes, and saved files; these are not settings.

## Acceptance Criteria

### AC-001 — Reset clears settings and previous identity
Given custom room, media, meeting, and identity values are persisted
When the user confirms Reset All Settings
Then LetShare restores default settings, the old display name/userId/uniqId are not restored after reload, and the new identity uses the existing fun-name pool
And user-created content stores remain intact. Authentication cookies, chat/meeting content databases, and downloaded model caches remain intact.

Verification: real-browser test uses Settings UI, confirms the reset dialog, then checks localStorage and identity after reload.

### AC-002 — Display name is editable from Settings and shared across flows
Given a user opens global Settings
When they edit and save the display name
Then the updated name is persisted without changing the stable uniqId and is reflected in ordinary-room and meeting identity state.

Verification: real-browser test opens Settings, edits the name, saves, reloads, and checks the persisted name and stable identity.

### AC-003 — New user can choose meeting display name
Given an identity with no explicitly confirmed display name opens a meeting
When the name gate appears and the user confirms an edited name
Then the meeting joins using that name and the identity is marked explicit.

Verification: existing meeting-name-gate E2E coverage or a real-browser test, plus identity tests.

## UI contract

- Global settings name field: accessible label `显示名称`, stable selector `settings-display-name`.
- Save is committed on Enter or blur.
- Reset uses the existing Reset All Settings button and existing confirmation prompt.
- Meeting name gate uses its existing `meeting-name-input` and `meeting-name-gate` selectors.

## Test Plan

- AC-001: browser E2E against the real Settings dialog, seed non-default settings and memorableState, reset, and assert defaults/new identity.
- AC-002: browser E2E edits and saves through Settings, then checks localStorage and stable uniqId after reload.
- AC-003: meeting name gate real-browser behavior plus identity unit tests.

## Non-scope

Do not clear chat/meeting content databases, downloaded AI model caches, or authentication cookies. Do not change ordinary call transport or meeting media/signaling.
