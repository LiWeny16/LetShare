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

## Deployment and acceptance — complete

- Frontend 3.8.48 deployed through the standard `deploy.cjs --frontend --no-build` flow after the successful normal build. Source commit `fecdd3999b917c7f98e8e84bc85529097d7ec4a8`; artifact commit `a8b8d999e1e0e2c96ad4af479027bddc424d63ce`.
- Origin, normal mainland CDN, and forced overseas GitHub Pages agree on version/build ID, HTML SHA and entry JS SHA. Automatic CDN purge was unavailable (no keys); acceptance uses actual normal resource requests. Deploy health wrapper skipped remaining curl checks after its proxy failure; independent direct surface checks and SSH origin checks passed.
- Production Edge and Chrome: five cases pass. Cold root mount 11,571 / 10,838 ms, no loading error card and no editor-named page JS requests; selected file survives selection/cancel; production HTTPS foreground/online/controllerchange dispatch preserves document, original WS and file; 15-second pre-native-probe suspension preserves original WS and peer presence; deliberate native socket close reconnects in about 1.3 seconds, peers visible and file retained.
- An extra background fixture was not counted: creating another isolated-context page did not change `document.hidden`. Another attempted run hit a Playwright extension-worker attachment assertion. Fresh dedicated profiles with extensions disabled completed all required cases; neither fixture issue is reported as a product failure or covered behavior.
- CI `39711675092` and Pages `39711674586` succeeded for the artifact commit. Backend remains active with unchanged SHA `b720a9226236d63f065de0d047fd369ac725e043ba7d93126d1e38a152e56853`.
- Independent Luna max final code/spec reflector: PASS, no blocking issue. HTTPS events were dispatched on the real production page, not an assertion that a naturally arriving worker update was observed. Native OS file picker and mobile coverage remain outside this evidence.
- Already-open 3.8.47 pages still execute their old inline code until refreshed/closed; the new script cannot retroactively change that document. A user refresh to confirm 3.8.48 completes the transition.
