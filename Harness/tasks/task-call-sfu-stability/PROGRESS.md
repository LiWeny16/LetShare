# 普通语音 SFU 双向稳定性 — 进度

## Status

- Phase: deployed and production-tested
- Next: cross-network browser proof requires an opsctl-approved remote test-script destination on `onion-3080`.

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
- Release: version `3.8.43`; build artifacts committed first as `baf6be4`, then the SFU fix as `efd9e1d`; both are on `main`. Frontend was deployed to the ECS static origin, which returned 200. Backend was not redeployed because there were no server-source changes.
- Public `version.json` reports `2026-10-04T10:09:47Z-jplfm`. Silent production audio E2E passed: both clients had bidirectional RTP, live unmuted remote tracks, `playing` audio sinks, no relay candidates, and 0.0% observed packet loss during the sample. Mute/unmute recovery also passed.
- Automatic CDN refresh was skipped because Aliyun credentials are absent; the production E2E nevertheless loaded the expected deployed frontend version.
