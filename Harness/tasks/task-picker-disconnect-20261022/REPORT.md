# 3.8.48 connection and loading hotfix

## Findings

The deployed 3.8.47 background timeout was still 10 minutes. The observed immediate offline status has a reproducible independent cause: after a 15-second JavaScript suspension immediately before a native liveness probe send, the old deadline callback declared a healthy WebSocket dead within 5 ms of resumption and forced reconnect. Opening a native OS file dialog itself was not directly automated.

The old inline update handler also cleared caches and reloaded active pages on a version mismatch after returning to the foreground. That path is deterministic in the regression harness; the controlled old production experiment reached its update branch but did not complete the asynchronous cleanup during observation, so it is not presented as the sole field cause.

The loading error card was reproduced in production. The old entry graph eagerly imported a 4,772,469-byte Excalidraw chunk through React DOM. Its measured download took about 49 seconds, beyond the 20-second boot fallback. All 117 queried assets returned 200 with expected MIME; this check did not find missing deployment assets.

## Corrections

- Liveness deadlines arriving substantially late send a fresh probe and grant its full response window. Stale run/probe callbacks cannot terminate newer probes. A genuinely silent fresh probe still expires normally.
- Foreground/online/version/controller checks preserve the current page. Worker updates wait for existing clients to close; no new GUI prompt or setting. Startup resource recovery is bounded to an empty root and one attempt per tab session.
- Navigation HTML uses NetworkFirst with a three-second cached fallback and a new cache name. Automatic chunk splitting removes the editor from normal startup dependencies. The timeout was not increased.
- BackgroundPolicy and its 10-minute timeout are unchanged.

## Accepted evidence

| Check | Result |
| --- | --- |
| Focused regressions, including existing background exemptions | 27/27 pass |
| TypeScript and normal frontend build | Pass |
| Manifest companion build validator | Index 167,225 B; Share 1,433,648 B; no editor-named static imports |
| Companion versus normal build entry/Share chunks | Byte-identical |
| Production Edge / Chrome cold mount | 11,571 / 10,838 ms; no error card |
| File selection/cancel | Selected file retained |
| Production HTTPS foreground/update events | Same document and healthy socket; file retained |
| 15-second suspension before native probe send | Original socket stays open; peer remains visible |
| Deliberate native socket close | New socket opens in about 1.3 s; peer and file retained |
| Origin, mainland CDN, overseas Pages | Version, HTML and entry hashes match |
| Independent Luna max code/spec reflector | PASS |

Browser evidence: [production](evidence/online-after.json), [local built preview](evidence/preview-after.json), [old-code suspension reproduction](evidence/stall-before.json). Release surfaces and CI are recorded in [surface checks](evidence/release-surfaces.json) and [CI](evidence/ci.json).

## Release

- Version: **3.8.48**; build ID `2026-10-22T02:18:24Z-agaf2`.
- Source: `fecdd3999b917c7f98e8e84bc85529097d7ec4a8`; generated artifacts: `a8b8d999e1e0e2c96ad4af479027bddc424d63ce`.
- [CI](https://github.com/LiWeny16/LetShare/actions/runs/39711675092) and [Pages](https://github.com/LiWeny16/LetShare/actions/runs/39711674586) succeeded for the artifact commit.
- Standard frontend deployment completed; the backend remains active on the same released binary. Pre-release frontend backup remains on the origin.

## Boundaries

These checks cover actual desktop Edge/Chrome and real production WebSockets, with controlled debugger suspension and dispatched HTTPS lifecycle events. They do not claim native OS picker, physical mobile, Safari/Firefox, a naturally arriving worker activation, file payload transfer, or Singapore–China media acceptance. Previously loaded 3.8.47 documents retain their old inline code until refreshed/closed; refresh once to confirm the footer shows 3.8.48.

A startup cache deletion initiated while the root is empty can finish after React mounts; subsequent mounted checks prevent reload. Mounted update checks never initiate cache deletion. This residual was reviewed as nonblocking.
