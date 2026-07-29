---
name: visible-browser-cdp-debug
description: Standard SOP for proving local web relay, P2P, or file transfer bugs in real visible browsers by launching separate Edge and Chrome instances and controlling them through Chrome DevTools Protocol (CDP). Use when the user asks for visible browser testing, Edge plus Chrome verification, Browser plugin or CDP control, room-based LetShare debugging, relay/WebSocket disruption retry or resume validation, or explicitly rejects headless/fake tests.
---

# Visible Browser CDP Debug

## Purpose

Use this skill to verify browser-dependent transfer bugs with two real visible browsers. Do not claim success from a single browser, two tabs, headless-only tests, or server logs when the user asked for Edge plus Chrome or visible browser evidence.

For detailed commands and reusable CDP snippets, read [references/visible-cdp-sop.md](references/visible-cdp-sop.md).

## Required Proof

Before calling the flow "run through", collect concrete evidence:

- Edge and Chrome are both open as distinct browser processes.
- Both browsers are in the same intended room. For LetShare, use room `123` unless the user specifies another room.
- The receiver and sender can see each other as connected users.
- The app state confirms server connection and room settings, not just the URL.
- The transfer path under test completes or fails with captured state, console errors, and relevant lifecycle timing.

For LetShare, prefer `window.__LET_SHARE_E2E__.getState()` when available. The app may strip `?room=123` from the URL after loading; verify `localStorage.user_settings.roomId` and E2E state instead of assuming the stripped URL means the room was not entered.

## Workflow

1. Start the relay/backend and frontend on fixed, known ports.
   - LetShare defaults used by this SOP: relay `27771`, frontend `27772`, Edge CDP `27773`, Chrome CDP `27774`.
   - Keep child processes alive for the whole manual-visible run.
   - Confirm ports with `netstat` or equivalent before driving browsers.

2. Launch real Edge and Chrome with separate CDP ports.
   - Use separate `--user-data-dir` values under the system temp directory.
   - Never put browser profiles under the repo workspace while Vite is watching files.
   - Use visible windows unless the user explicitly accepts headless.

3. Control both browsers through CDP.
   - Use a local `node` process for CDP scripts on Windows.
   - Open pages with `PUT http://127.0.0.1:<port>/json/new?about:blank`.
   - Connect to `webSocketDebuggerUrl`, enable `Runtime`, `Page`, `DOM`, and `Network`.
   - Always close the WebSocket and exit the Node process, or shell commands can hang.

4. Seed app state before navigation.
   - For LetShare, seed `localStorage.user_settings` with all required default settings, including `roomId`, `serverMode`, `customServerUrl`, `transferPriority`, and `version`.
   - Seed distinct `memorableState.uniqId` values such as `edge:room123` and `chrome:room123`.
   - Navigate both browsers to the same room URL, for example `http://127.0.0.1:27772/?room=123&region=china`.

5. Discover peers and assert state.
   - Trigger the app's discovery hook in both browsers when available, such as `window.__LET_SHARE_E2E__.broadcastDiscover()`.
   - Assert both sides report `isConnectedToServer:true`.
   - Assert each browser sees the other user's ID in connected users.

6. Run the real transfer action.
   - Use `DOM.setFileInputFiles` to attach local files.
   - Click the actual visible user row or button with a stable selector.
   - For large direct-save prompts, create sparse files with `fs.truncateSync()` rather than writing huge byte arrays.
   - For interruption or lifecycle bugs, wait beyond the known timeout window and re-read state.

7. Close out with evidence.
   - Report browser names, CDP ports, room ID, file size, sender/receiver IDs, transfer status, and test commands.
   - If a connector was unavailable, say so plainly and describe the CDP fallback used.

## LetShare Checks

Use these acceptance checks for the relay/file-transfer class of bugs:

- Small file: Chrome selects a file, clicks Edge user, Edge receives the exact byte count, Chrome reports success.
- Relay fallback: configure server transfer mode or make P2P unavailable, then verify relay ACK/retry/resume state rather than only detecting a WebSocket error.
- Huge file direct save: send a sparse 10GB file, assert the receiver shows `pendingDirectSaveRequest`, wait at least 35 seconds, and assert the prompt and server connection still exist.
- Room correctness: if the settings dialog says room is required, the browser was not initialized correctly. Seed settings or enter room `123` visibly before testing.

## Pitfalls

- Browser plugin availability is not guaranteed. If `agent.browsers.get("iab")` fails or only a Chrome extension backend is listed, do not pretend Edge is controlled by the plugin. Launch Edge directly with CDP.
- The Codex Node REPL connector may not expose `process` or `WebSocket`. Use local shell `node` for CDP scripts unless you have verified those globals exist.
- Vite can crash if browser profiles live in the repo, with errors like `EBUSY ... Network\Cookies`. Put profiles in `$env:TEMP`.
- A dev server started from a short-lived REPL or command can exit after the command returns. Keep the process handle alive or use an explicit background process.
- CDP scripts with open WebSockets can time out silently. Close sockets and call `process.exit(0)`.
- Query stripping after load is normal in LetShare. Validate state from localStorage and E2E hooks.
- A successful unit test is not a substitute for this skill when the user requested visible Edge plus Chrome proof.
