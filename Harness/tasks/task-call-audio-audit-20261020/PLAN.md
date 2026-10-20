# Cross-border call audio audit

Mode: direct. Audit completed; user subsequently approved fixes with “行 修复吧”. Separate from the existing AI-minutes task; do not modify that task or its active pointer.

## Goal and acceptance

- AC-001: identify the current audio call transport and trace signaling, capture, send, SFU forwarding, receive, and playback.
- AC-002: report evidence-backed defects capable of intermittent or one-way silence, separating confirmed code defects from unproven incident causes.
- AC-003: distinguish current behavior from historical P2P fixes and explain missing runtime evidence for Singapore-China failures.

## Scope

Audit phase was read-only. The approved repair phase allows targeted call/session/playback source, regression tests, the SFU fanout lifecycle defect, and correcting stale audio-transport documentation. No deployment, infrastructure migration, git mutation, credentials output, or unrelated fixes. Existing docs build changes are pre-existing; build to a fresh temporary output directory.

## Approved repair acceptance and contracts

- FIX-AC-001: TURN refresh received while an incoming session has no PCs must be used by its publisher, later subscriber, and recreated subscriber; refreshed active PCs also receive the configuration. Both call roles retain relay fallback. Ordinary signaling and media protocol remain compatible.
- FIX-AC-002: new live audio/video tracks supersede old same-kind tracks, including ended tracks; retain unrelated live kinds, ignore exact duplicate notifications, and provide a changed stream identity when the track set changes. Session → React → playback must converge on the new audio source without requiring a preference change. Never stop tracks owned by the peer/session merely to merge UI streams.
- FIX-AC-003: a fanout whose RTP reader exits must report closed and reject new subscribers/outputs, including natural reader errors while the participant stays live.
- FIX-AC-004: real browser call starts, receives and decodes nonzero synthetic audio in both directions, and subscriber replacement restores the playback track. Verify local direct and forced TURN paths where available; no claim of actual Singapore-China or physical-speaker acceptance.

Implementation design approved by the existing report + user go-ahead: preserve latest RTC config before constructing PCs; merge tracks by identity and replace same-kind superseded tracks using a fresh stream snapshot; rebind WebAudio source on changed streams; close fanout on every reader exit. Keep TLS443/region deployment for a separately reviewed infrastructure change.

Testing seam: `mergeRemoteCallStream(current: MediaStream | null, incoming: MediaStream): MediaStream` in `src/app/libs/call/remoteStream.ts`; returns the existing stream for an identical track set, otherwise returns incoming or a fresh merged stream. Inputs include audio/video split arrivals and replacement tracks. Both UI and session use the same small merge helper.

Browser UI contract: local root route in room 123; buttons by existing accessible names 语音通话 / 接听 / 挂断. Use actual SFU WebSocket messages call:sfu:join and meeting:sdp/meeting:ice; no production endpoint mutation. Debug hooks __lsPc/__lsCallStats enabled only in the test profile, plus real output MediaStream track and decoding counters. BrowserOS Neo tools are absent; repository's explicit visible Edge/Chrome CDP SOP supplies the required multi-browser instrumentation capability.

Verification: RED before implementation; targeted Node/Go regressions; TypeScript and build in fresh temp output; visible real browser checks with synthetic microphone tone and scoped local server. Independent reviewer/verifier and reflector before closeout. Test acceptance derives from these FIX-ACs; no arbitrary coverage percentage is configured for this slice.

## Subagent Dispatch

All agents: gpt-6-luna, max reasoning, clean native contexts, reviewer role. Hard deadline: 15 minutes each; cancel using interrupt_agent if exceeded. No child agents or external CLIs.

| Task | Read set | Write set | Dependency | Output | Status |
|---|---|---|---|---|---|
| Audio capture/playback | src/pages/share.tsx, src/components/call, src/app/libs/call, relevant tests/history | none | none | Ranked evidence and reproducible triggers | Integrated |
| Signaling/recovery | src/app/libs/call, connection providers, relevant tests/history | none | none | Ranked evidence and reproducible triggers | Integrated |
| SFU/network | server/internal/sfu, call handler, TURN/config, relevant tests/history | none | none | Ranked evidence and reproducible triggers | Integrated |
| Independent report reflection (audio reviewer reused) | REPORT.md, probes, cited source | none | Audit synthesis | Accuracy verdict, not implementation acceptance | Verified (PASS) |

## Verification

Controller re-reads cited code and challenges hypotheses against tests and current transport. Audit verification used bounded causal probes; the subsequently approved repair uses the FIX-AC contracts above. No claim of real cross-border reproduction without both endpoint telemetry.

## Context

Read CLAUDE.md, startup hints, project memory index, active-task state/progress/plan for routing, Harness memory/router and subagent protocols. Memory hints: none relevant to call silence beyond historical call RCA/feature doc. User explicitly requested GPT-6 Luna max subagents.

## Controller synthesis

- Accepted: F1 incoming session snapshots stale RTC config and does not persist refreshed config for future subscribers; F2 UI rejects replacement audio of the same kind; F3 natural SFU read-loop exit does not update its closed state (conditional trigger).
- Rejected as current proven causes: historical P2P sink RCA; bare pipeline.attach source reuse (current CallBar setPrefs rebuilds); hypothetical caller early callback without a verified browser timing; generic cross-border/Edge/TURN-server blame.
- Severity adjudication: audio reviewer rates F2 High, signaling reviewer Medium because recovery conditional. Controller retains High for the persistent loss of playback after successful subscription replacement, explicitly states its condition, and does not attribute first-attempt silence without restart evidence.
- User clarification: both Edge, no VPN, one-way silence immediately upon connection. Operating systems and incident telemetry remain unknown.
- Source baselines: frontend/root HEAD 6b66bd3; server submodule HEAD 2b8a58e.
- Validation: 33 targeted existing tests pass; actual-module synthetic RTC probe confirms new callee subscriber missing TURN after fetch completed; AST-extracted actual UI callback retains ended old audio despite a live replacement. Durable probe: audit-probes.mjs. Not real browser or cross-border evidence.
- Audit-phase write set was diagnostic only; product repairs were subsequently authorized and are tracked below.
- Independent reflection: PASS for report accuracy and AC-001..003 coverage. This closes the requested repository audit, not bug remediation or production acceptance.
- Backend reviewer delivered bounded findings and network facts in evidence messages; controller verified the cited files and stopped additional agent work once scope was covered. No backend test or runtime PASS is inferred from that stop.

## Repair decisions and evidence

- The actual headed Edge/Chrome path reproduced replacement failure: a new connected subscriber received RTP while the UI retained the ended old track and old stream. The SFU reused the same string track ID across generations; native object identity is the required discriminator.
- Session and React share the small merge helper. New live same-kind tracks replace older tracks; ended incoming tracks are ignored; unrelated live tracks survive. Changed track sets produce fresh immutable stream snapshots, so the playback host reattaches without preference changes. No merge stops session-owned tracks.
- Additional test-writer RED confirmed session audio/video arrivals mutated earlier snapshots and ended incoming tracks displaced live audio; both cases were repaired before final review.
- Repair roles: test-only client writer, test-only real Pion lifecycle writer, test-only headed browser writer/verifier, controller implementation, independent code/spec review, final acceptance reflection. All native subagents use requested GPT-6 Luna max; no peer CLI overflow or child agents.
- No protocol change, provider migration, new network service, dependency, or production deployment. TURN/TLS443 and regional routing remain infrastructure follow-up.
- Completion: FIX-AC-001..004 pass the linked regressions and final independent code/spec/reflector gates. 134 client tests, Go SFU/handler, TypeScript, isolated production build, headed direct and forced-relay recovery pass. Own test services/browsers stopped; no real cross-border/physical-speaker or TCP-only TURN claim. See REPORT.md repair matrix for evidence and local topology/capacity follow-ups.

## Authorized production release

- User explicitly requested full production deployment after accepting the completed repair. Release v3.8.46 includes the validated current call stack and these fixes, frontend and backend, version sentinel, source/artifact publication, and online health/version checks. It does not add new TLS443 listeners, expand relay ports, or migrate regional media infrastructure.
- Original developer worktree and pre-existing generated docs/runtime modifications are preserved. Release is isolated at `.tmp/release-call-audio-3.8.46` on `main`, integrating current remote-main artifact/obsolete-diagnostic cleanup with the validated rewrite history. Only generated HTML/gzip/SW merge conflicts were resolved before regenerating production artifacts.
- Server fix committed as `d78c8b1`; root release records that submodule commit and publishes it before root main. No force push. Both package and MobX default version become 3.8.46; cache strategy names stay unchanged, build regenerates the sentinel.
- Canonical `scripts/deploy.cjs` performs frontend/backend rollout. Because frontend extraction is not atomic and script health checks are advisory, retain a separate remote frontend tar/backend binary backup and independently compare exact origin/CDN/Pages version/build values and deployed binary checksum. Verify GitHub CI/Pages after publishing.
- Remote backup completed at `/root/cloud/backups/call-audio-3.8.46-20261020/`; old backend SHA256 `281e6af13ecd32f21cb5e4b2bf7262ca7aca66ca7ea4bb1e77eef8ec2f475751` and frontend archive retained. If rollout fails, restore the matching backup before declaring success.
- Independent read-only release reviewer PASS with these backup, branch, and exact-version safeguards. Aliyun API credentials are absent in current env; CDN freshness must be measured even if automatic purge is skipped.
- CI release gate discovered existing cleanup-field races. Existing repair/full-release authorization covers this bounded lifecycle correction: registered startup callbacks survive in-flight cleanup, connection state uses ConnMutex consistently, deterministic callback-loss regression RED→GREEN, full Go race suite and independent review PASS. No protocol or subsystem change. Corrected backend revision is `052e483`.
