# pro-public-relay-auth-sync - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.
Do not paste logs; record the command/file that proves the state.

## Status

- Phase: Focused review integrated
- Next: Decide whether to add provider-mode contract/tests or close with custom public relay scope.
- Blocker: none

## Tasks

- [x] Define goal and scope
- [x] Run parallel exploration on auth state, transport choice, and tests
- [x] Dispatch implementation workers with disjoint write sets
- [x] Verify and close out
- [x] Focused reviewer check for PRO/public-relay/key transport logic

## Changes

- `src/app/libs/connection/proUpgrade.ts`: `isPro()` now depends on relay token, not invite-code cookie.
- `src/components/ProUpgradeDialog.tsx`: invite code is reloaded from cookie whenever the dialog opens, so the UI still prefills the previously entered code.
- `src/app/libs/connection/colabLib.ts`: track the PRO token used by the active custom socket, reconnect before >50MB relay sends when auth is stale, and stop clearing stored PRO credentials on generic upgrade-required errors.
- `src/app/libs/connection/colabLib.ts`: P2P helper now fails fast when the data channel is unavailable instead of silently switching transport.
- `src/pages/share.tsx`: sender-selected `server` priority now stays on relay and no longer silently falls back to P2P.
- Added regression coverage in `tests/publicRelayAuthSync.test.ts` and `tests/shareTransportPriority.test.ts`.

## Verification

- `go test ./internal/service -run TestCreateTransferSession -v` passes; backend size-limit policy currently behaves as designed.
- `node --import tsx --test tests/publicRelayAuthSync.test.ts tests/shareTransportPriority.test.ts` passes.
- `npm run build` passes.
- `npm test` still has unrelated pre-existing failures in `tests/chatPanelFocus.test.ts`, `tests/pwaUpdate.test.ts`, `tests/serverRelaySendCompletion.test.ts`, and `tests/transferReliability.test.ts`.
- Focused `gpt-5.5/xhigh` reviewer returned `PASS_WITH_CONCERNS`: no blocking/high findings for the custom public relay path; medium concern is provider-mode contract if Ably/global is expected to behave as public relay.

## Notes

- Root cause was auth-state drift: service-side PRO gating is bound at WebSocket handshake time, while the frontend previously treated a saved invite-code cookie as enough to show PRO and did not refresh the active custom socket after activation.
- Spawned focused read-only reviewer `019f6a37-dd4b-7760-83f2-d144ef1db017` using `gpt-5.5` with `xhigh` reasoning to check AC-001/AC-002/AC-003 only.
- Reviewer suggested follow-ups: behavior-level fake custom connection test for old-token reconnect; dialog activation resume test; provider-mode contract test for `server` priority under Ably/global; expired/invalid token UX decision.
