# 普通语音 SFU 双向稳定性 — 进度

## Status

- Phase: release preparation
- Next: commit/push the reviewed frontend fix, deploy it through the standard frontend release command, then run the silent production E2E.

## Evidence so far

- ECS service was active with low RSS/load and ample available memory; no kernel OOM record was found in the checked period.
- Host-wide UDP receive and receive-buffer errors are cumulative and cannot identify loss for one call.
- Current client code can mark the call active when either publisher or subscriber is connected.
- Current recovery loop ICE-restarts only the caller; SFU sessions are independent client-to-server transports.
- A server participant removed after `PeerConnectionStateFailed` must rejoin before a new publish offer can be handled.
- Current audio loss sampling reads `fractionLost` from `inbound-rtp`; the W3C stats contract places it on remote-inbound stats, while inbound stats expose packet counters.
- Ordinary audio remains public-SFU-only; no TURN/P2P changes are in scope.
- AC-004 tests reproduced false-active state and subscriber disconnects that never entered recovery. Active now requires both SFU PCs connected plus a live, unmuted inbound audio track.
- AC-005 tests reproduced caller restart without `call:sfu:join` and no callee restart. SFU caller and callee now rejoin before ICE-restart publish SDP.
- AC-006 tests reproduced the invalid inbound `fractionLost` read. Audio byte/packet counters, packet-loss deltas, audio level, and remote audio playback errors are now exposed through session diagnostics.
- AC-007 adds an 8-second post-accept setup watchdog and a 25-second recovery limit, so stuck ordinary calls do not retry forever.
- Unit file `tests/callSfuStability.test.ts` passes 7 targeted regression cases. The full suite passes 520 tests; `pnpm exec tsc --noEmit`, production build, and scoped ESLint all pass.
- Production E2E now runs Chromium with `--mute-audio` and checks both publisher/subscriber states, inbound/outbound RTP, audio playback state, and absence of relay candidates.
- Cross-network browser automation on asset `onion-3080` is blocked: opsctl rejected transferring the temporary test script to `/tmp/letshare-e2e` as outside the approved scope (`\tmp\letshare-e2e`). The temporary Selenium install was removed; no policy bypass was attempted.
- ECS remains healthy in the checked snapshot: systemd active, low memory/CPU, no OOM or crash loop. UDP receive-buffer counters are cumulative and not call-correlated.
