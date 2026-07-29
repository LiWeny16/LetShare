# Visible Browser CDP SOP

## Contents

- Launch layout
- Browser launch commands
- CDP control skeleton
- LetShare room seeding
- Transfer actions
- Evidence checklist
- Known failure signatures

## Launch Layout

For LetShare local relay testing, use stable ports so evidence is repeatable:

| Component | Port | Example |
|---|---:|---|
| Relay/backend WebSocket | 27771 | `ws://127.0.0.1:27771/ws` |
| Frontend | 27772 | `http://127.0.0.1:27772/` |
| Edge CDP | 27773 | `http://127.0.0.1:27773/json/version` |
| Chrome CDP | 27774 | `http://127.0.0.1:27774/json/version` |

Start the repo's backend and frontend in a way that keeps them alive. For LetShare, the backend must honor:

```powershell
$env:LETSHARE_SERVER_PORT = "27771"
```

Confirm all listeners:

```powershell
netstat -ano | Select-String ":27771|:27772|:27773|:27774"
```

## Browser Launch Commands

Use system temp profiles, not repo-local profiles:

```powershell
$edgeProfile = Join-Path $env:TEMP "letshare-edge-room123"
$chromeProfile = Join-Path $env:TEMP "letshare-chrome-room123"

$edgeExe = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (!(Test-Path $edgeExe)) { $edgeExe = "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe" }

$chromeExe = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
if (!(Test-Path $chromeExe)) { $chromeExe = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" }

Start-Process -FilePath $edgeExe -ArgumentList @(
  "--remote-debugging-port=27773",
  "--user-data-dir=$edgeProfile",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank"
)

Start-Process -FilePath $chromeExe -ArgumentList @(
  "--remote-debugging-port=27774",
  "--user-data-dir=$chromeProfile",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank"
)
```

Verify:

```powershell
Invoke-RestMethod "http://127.0.0.1:27773/json/version"
Invoke-RestMethod "http://127.0.0.1:27774/json/version"
```

## CDP Control Skeleton

Run CDP scripts with the local `node` executable, not the Codex Node REPL connector unless that connector has verified `process` and `WebSocket` globals.

```js
const debugPort = Number(process.argv[2]);
const targetUrl = process.argv[3];

let seq = 0;
const pending = new Map();

const page = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
  method: "PUT",
}).then((r) => r.json());

const ws = new WebSocket(page.webSocketDebuggerUrl);

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
  });
}

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (!msg.id) return;
  const item = pending.get(msg.id);
  if (!item) return;
  pending.delete(msg.id);
  if (msg.error) item.reject(new Error(`${item.method}: ${JSON.stringify(msg.error)}`));
  else item.resolve(msg.result);
});

await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
await send("Runtime.enable");
await send("Page.enable");
await send("DOM.enable");
await send("Network.enable");

// Add seeding and actions here.

await send("Page.navigate", { url: targetUrl });
await new Promise((resolve) => setTimeout(resolve, 2000));

ws.close();
process.exit(0);
```

For repeated work, wrap the skeleton in helpers:

```js
async function evalValue(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function setFileInput(selector, files) {
  const doc = await send("DOM.getDocument", { depth: -1, pierce: true });
  const found = await send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector,
  });
  if (!found.nodeId) throw new Error(`Missing file input: ${selector}`);
  await send("DOM.setFileInputFiles", { nodeId: found.nodeId, files });
}
```

## LetShare Room Seeding

Seed before navigation with `Page.addScriptToEvaluateOnNewDocument` or navigate to `about:blank` and run `Runtime.evaluate`.

```js
function letShareSeedScript({ uniqId, roomId = "123", relayPort = 27771, priority = "p2p" }) {
  const settings = {
    userTheme: "light",
    userLanguage: "en",
    roomId,
    serverMode: "custom",
    customServerUrl: `ws://127.0.0.1:${relayPort}/ws`,
    authToken: "",
    ablyKey: "",
    transferPriority: priority,
    version: "3.5.6",
    isNewUser: false,
  };

  return `
    localStorage.setItem("user_settings", ${JSON.stringify(JSON.stringify(settings))});
    localStorage.setItem("memorableState", ${JSON.stringify(JSON.stringify({ uniqId }))});
  `;
}

await send("Page.addScriptToEvaluateOnNewDocument", {
  source: letShareSeedScript({ uniqId: "edge:room123" }),
});

await send("Page.navigate", {
  url: "http://127.0.0.1:27772/?room=123&region=china",
});
```

After both browsers load, assert room and peer state:

```js
const state = await evalValue(`(() => {
  const settings = JSON.parse(localStorage.getItem("user_settings") || "{}");
  const e2e = window.__LET_SHARE_E2E__;
  return {
    href: location.href,
    roomId: settings.roomId,
    customServerUrl: settings.customServerUrl,
    app: e2e ? e2e.getState() : null,
  };
})()`);
```

Trigger discovery:

```js
await evalValue(`window.__LET_SHARE_E2E__?.broadcastDiscover?.()`);
```

Acceptance:

- `roomId` is `"123"`.
- `customServerUrl` is `ws://127.0.0.1:27771/ws`.
- `app.isConnectedToServer` is `true`.
- Each browser sees the other user ID as connected.

## Transfer Actions

Create a small file for basic transfer:

```powershell
$small = Join-Path $env:TEMP "letshare-visible-room123-small.txt"
Set-Content -LiteralPath $small -Value ("visible room 123 transfer " * 128)
```

Attach and send from Chrome to Edge:

```js
await setFileInput("#multi-file-input", [smallPath]);
await evalValue(`document.querySelector('[data-testid="connected-user"][data-user-id="edge:room123"]')?.click()`);
```

Create a sparse 10GB file for direct-save prompt testing:

```powershell
node -e "const fs=require('fs'),os=require('os'),path=require('path');const p=path.join(os.tmpdir(),'letshare-visible-10gb.bin');fs.closeSync(fs.openSync(p,'w'));fs.truncateSync(p,10*1024*1024*1024);console.log(p)"
```

Attach the sparse file from sender, click receiver, then assert on the receiver:

```js
const directPromptState = await evalValue(`(() => {
  const state = window.__LET_SHARE_E2E__?.getState?.();
  return {
    pending: state?.pendingDirectSaveRequest ?? null,
    receiving: state?.directReceivingFiles ?? [],
    saved: state?.directSavedFiles ?? [],
    connected: state?.isConnectedToServer,
    bodyText: document.body.innerText,
  };
})()`);
```

For lifecycle regression testing, wait past the cleanup threshold and assert again:

```js
await new Promise((resolve) => setTimeout(resolve, 35000));
```

The prompt must still exist, the connection must remain up, and `pendingDirectSaveRequest.fileSize` should be `10737418240`.

## Evidence Checklist

Include these details in the final result:

- Browser processes: Edge CDP port and Chrome CDP port.
- Room ID and server URL from browser state.
- Sender and receiver `uniqId`.
- Transfer mode under test: P2P, relay fallback, or direct-save prompt.
- File name and byte size.
- Receiver state and sender state after transfer.
- Commands run: unit tests, build, server tests, and CDP browser tests.
- Any screenshot or visible-browser observation when the user is inspecting the UI.

## Known Failure Signatures

- Settings modal says room ID is required: app settings were not seeded or saved before navigation.
- URL is `/` after load: normal for LetShare if state says room `123`.
- Vite `EBUSY ... Network\Cookies`: browser profile was placed under the watched repo; move it to `$env:TEMP`.
- CDP command times out with no output: WebSocket likely stayed open; close it and call `process.exit(0)`.
- Only one browser opened: do not continue if the user required Edge plus Chrome.
- `Browser is not available: iab`: Browser connector is unavailable; use direct CDP launch and report the fallback.
- Receiver prompt disappears after about 30 seconds: lifecycle cleanup may be treating a pending direct-save request as idle; inspect active-transfer accounting.
