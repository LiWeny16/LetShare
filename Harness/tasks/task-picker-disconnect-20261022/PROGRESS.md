# Progress

- Investigating. Deployed v3.8.47 source compared with v3.8.46: BACKGROUND_TIMEOUT remains 10 minutes; BackgroundPolicy and visibility watcher were not changed by the file v2 release.
- This does not disprove the reported regression. Checking independent liveness, lifecycle, render cleanup and server-disconnect paths, plus browser reproduction.
- Independent debugger: /root/disconnect_audit (gpt-6-luna, max), read-only.

## Confirmed observations

- Actual production Edge cold start requested `excalidraw-vendor-BclfdEHS.js` (4,772,469 bytes) as an eager React DOM dependency; download took 48,991.5 ms. The 20-second bootstrap fallback displayed the exact reported loading error before the app eventually mounted. All 117 checked production resources returned 200 and expected MIME; no missing resource found in this surface check.
- Fresh Edge and Chrome input selection and 35-second extra-tab scenario remained connected. This is a baseline, not a reproduction of the user's immediate disconnect. Native OS picker/background throttling is not yet covered.
- Found separate foreground update hazard: existing `index.html` reloads mounted pages on a changed version sentinel or SW controller, including visibility return. Controlled production reproduction is running; do not yet label this the sole field cause.
- Luna audit worker now implements only Vite boot graph isolation in isolated release tree; /root/foreground_disconnect_fix implements only bounded page update lifecycle and its regression tests. Disjoint write sets; parent owns release/integration and browser evidence.

## Reproduction and correction

- Controlled real production WS experiment: CDP pauses JS for 15,007 ms immediately before the first intercepted native liveness probe send, then resumes. Within 5 ms, old code reports `liveness-timeout (probe=8, waited=15013ms)`, closes the old healthy WS (1005), and opens a replacement. Evidence: `.tmp/picker-regression/stall-before.json`. This reproduces suspension-induced reconnect; it does not claim the native OS picker was directly automated.
- Mounted foreground version mismatch deterministically calls unregister/reload in the index-script VM regression. Production controlled mismatch activates `[SW] Version changed` but cache cleanup did not complete during the observation; no production reload is claimed for that separate experiment.
- Vite experiment removes package manualChunks: initial 22 JS references / 5,028,412 bytes become 2 / 167,225 bytes, with no editor dependency. Share static graph is about 1.43 MB and excludes editor; no expansion into unrelated dialog UX.
- Implementer write set expanded to LivenessMonitor and focused regression tests for suspension safety. BackgroundPolicy remains unchanged.

## Pre-release verification (3.8.48)

- Focused root regression: 27/27 pass across pageUpdateLifecycle, livenessDeadlineLateness, existing livenessProbe, and backgroundExemption. Normal deadlines, stale callbacks, fresh-probe failure, and the existing 10-minute background policy remain covered.
- TypeScript check and standard `npm run build` pass. Manifest-enabled companion output passes `scripts/verify-boot-chunks.cjs`; its index and Share output are byte-identical to the standard build. Index static graph: 167,225 bytes; Share: 1,433,648 bytes. Validator checks static edges, editor-named chunks and byte budgets, not every bundled module ID.
- Actual built preview in separate Edge/Chrome processes passes: root mount 409/480 ms; room 123 peers visible; file selection and cancellation preserve selection; a 15-second debugger suspension immediately before a real native probe send keeps the original document and WS after resumption. No fake server responses. HTTP preview cannot accept the HTTPS service-worker lifecycle; production verification remains pending.
- Independent Luna max reviewer finds no blocking code/spec issue before deployment. Bounded residual: a startup cache deletion initiated before React mounts may finish after mount; mounted checks prevent subsequent reload and no mounted version-check path initiates deletion.
- Release candidate: 3.8.48, sentinel `2026-10-22T02:18:24Z-agaf2`. Frontend-only rollout pending. Backend SHA recorded before deployment; frontend backup `/root/cloud/letshare-frontend.pre-picker-fix-3.8.48.tgz` exists.
- Verification boundary: neither native OS picker automation nor physical mobile/Safari/Firefox or cross-country media acceptance is claimed.
