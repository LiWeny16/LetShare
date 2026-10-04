# 普通语音 SFU 双向稳定性

## Mini PRD

- Goal: prevent ordinary pure-audio SFU calls from appearing healthy while one media direction is unavailable, and allow either endpoint to restore its own public-SFU publisher after a disconnect.
- Scope: `CallSfuSession` and `CallManager` ordinary audio state/recovery, plus correct audio RTP diagnostics.
- Non-scope: P2P, TURN, video/meeting transport changes, UI redesign, SFU migration, multi-region deployment.
- Route constraint: ordinary audio remains on the public LetShare SFU; never create P2P media or TURN relay candidates.

## Acceptance criteria

### AC-004: A one-way SFU call is not reported as active

Given an ordinary audio call has a publisher PeerConnection and a remote subscriber PeerConnection
When only one connection reaches `connected`, or the remote audio track has not unmuted after receiving media
Then the call remains connecting/reconnecting and recovery stays enabled
When both connections reach `connected` and the remote audio track is live and unmuted
Then the call becomes active and recovery stops

Verification: unit regression tests against `CallSfuSession` and `CallManager`.

### AC-005: Either endpoint can recover its public-SFU publisher

Given either the caller or callee enters reconnecting during an ordinary audio call
When the bounded recovery attempt runs
Then that endpoint re-sends `call:sfu:join` before an ICE-restart publish offer, so a server participant removed after ICE failure can be registered again
And neither P2P SDP/ICE nor TURN credentials/candidates are used

Verification: unit signal-order tests plus muted cross-network browser E2E through `wss://ecs.letshare.fun/`, asserting both endpoints' inbound audio RTP increases and selected candidate type is not `relay`.

### AC-006: Audio quality diagnostics use standard inbound RTP counters

Given an ordinary audio call has inbound audio stats
When quality is sampled
Then diagnostics include inbound audio bytes/packets, jitter, packet-loss deltas, and remote audio playback state/error
And absent fields remain explicitly unavailable rather than being read from the wrong stats type

Verification: deterministic stats fixtures and a muted cross-network E2E stats snapshot.

### AC-007: Connection setup and recovery are bounded

Given the peer accepted but the two-way SFU media path does not complete
When the setup watchdog or the reconnect window expires
Then the call enters recovery and ends cleanly after the bounded recovery window, stopping retry timers and releasing media resources.

Verification: fake-timer unit test for setup watchdog, 25-second recovery expiry, and ended-state cleanup.

### AC-008: Peer membership loss rebuilds the subscriber transport

Given the remote participant leaves the private SFU room and later rejoins
When membership changes arrive
Then the stale subscriber PeerConnection is closed and removed, and the rejoined participant gets a fresh subscription.

Verification: unit test for membership leave cleanup and rejoin subscription request.

## Verification matrix

| AC | Unit | Browser/E2E | Build |
|---|---|---|---|
| AC-004 | state transitions with publisher/subscriber/audio-track fakes | two-way call must not report active until both directions receive audio | `pnpm build` |
| AC-005 | both-role recovery signal ordering, no TURN/P2P | muted local + ECS client, bidirectional RTP, no relay candidate | `pnpm test:e2e:call` or the authorized cross-network probe |
| AC-006 | WebRTC stats field fixtures, counter deltas, playback failure | capture both endpoints' inbound audio counters and playback state | `pnpm build` |
| AC-007 | fake timers and cleanup assertions | a broken call exits its recovery loop after the limit | `pnpm build` |
| AC-008 | member leave/rejoin and subscriber replacement | both clients rebuild receive tracks after network rejoin | `pnpm build` |
