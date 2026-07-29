import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AUTH_TOKEN =
  "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652";
const PORT_BASE = 26_000 + Math.floor(Math.random() * 20_000);
const SERVER_PORT = PORT_BASE;
const FRONTEND_PORT = PORT_BASE + 1;
const RECEIVER_DEBUG_PORT = PORT_BASE + 2;
const SENDER_DEBUG_PORT = PORT_BASE + 3;
const ROOM_ID = process.env.ROOM_ID || "123";
const APP_URL = `http://127.0.0.1:${FRONTEND_PORT}/`;
const SERVER_WS_URL = `ws://127.0.0.1:${SERVER_PORT}/ws`;
const TEST_FILE_NAME = "p2p-direct-disk-over-threshold.bin";
const LARGE_FILE_SIZE = 3 * 1024 * 1024 * 1024 + 1024;

test(
  "Edge receiver shows direct-to-disk save request for oversized P2P file from Chrome",
  { timeout: 120_000 },
  async (t) => {
    const tempRoot = mkdtempSync(join(tmpdir(), "letshare-p2p-direct-disk-"));
    const filePath = join(tempRoot, TEST_FILE_NAME);
    writeFileSync(filePath, "");
    truncateSync(filePath, LARGE_FILE_SIZE);

    const server = spawnManaged(t, "go", ["run", "./cmd/server"], {
      cwd: join(process.cwd(), "server"),
      env: {
        ...process.env,
        MODE: "local",
        LETSHARE_SERVER_PORT: String(SERVER_PORT),
        GIN_MODE: "release",
      },
    });

    const frontend = spawnNpmManaged(t, [
      "run",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(FRONTEND_PORT),
      "--strictPort",
    ]);

    await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`, 30_000);
    await waitForHttp(APP_URL, 30_000);

    const receiverBrowser = spawnManaged(
      t,
      findBrowserExecutable("edge"),
      [
        "--headless=new",
        `--remote-debugging-port=${RECEIVER_DEBUG_PORT}`,
        `--user-data-dir=${join(tempRoot, "edge-receiver-profile")}`,
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { cwd: process.cwd(), env: process.env }
    );
    const senderBrowser = spawnManaged(
      t,
      findBrowserExecutable("chrome"),
      [
        "--headless=new",
        `--remote-debugging-port=${SENDER_DEBUG_PORT}`,
        `--user-data-dir=${join(tempRoot, "chrome-sender-profile")}`,
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { cwd: process.cwd(), env: process.env }
    );

    await Promise.all([
      waitForHttp(`http://127.0.0.1:${RECEIVER_DEBUG_PORT}/json/version`, 30_000),
      waitForHttp(`http://127.0.0.1:${SENDER_DEBUG_PORT}/json/version`, 30_000),
    ]);

    const receiver = await openPage({
      debugPort: RECEIVER_DEBUG_PORT,
      userId: "edge-receiver",
      uniqId: "edge-receiver:p2p-disk",
      transferPriority: "p2p",
    });
    const sender = await openPage({
      debugPort: SENDER_DEBUG_PORT,
      userId: "chrome-sender",
      uniqId: "chrome-sender:p2p-disk",
      transferPriority: "p2p",
    });

    t.after(async () => {
      await Promise.allSettled([sender.close(), receiver.close()]);
      await Promise.allSettled([
        killProcess(senderBrowser.child),
        killProcess(receiverBrowser.child),
        killProcess(server.child),
        killProcess(frontend.child),
      ]);
      rmSync(tempRoot, { recursive: true, force: true });
    });

    await Promise.all([
      receiver.navigate(`${APP_URL}?room=${encodeURIComponent(ROOM_ID)}&region=china`),
      sender.navigate(`${APP_URL}?room=${encodeURIComponent(ROOM_ID)}&region=china`),
    ]);

    await Promise.all([
      waitForE2EHook(receiver, "Edge receiver"),
      waitForE2EHook(sender, "Chrome sender"),
    ]);

    const receiverPickerSupport = await receiver.evaluate(
      `typeof window.showSaveFilePicker === "function"`
    );
    assert.equal(receiverPickerSupport, true, "Edge receiver must expose showSaveFilePicker");

    await Promise.all([
      waitForState(
        receiver,
        (state) => state.isConnectedToServer === true,
        "Edge receiver did not connect to local relay"
      ),
      waitForState(
        sender,
        (state) => state.isConnectedToServer === true,
        "Chrome sender did not connect to local relay"
      ),
    ]);

    await Promise.all([
      sender.evaluate(`window.__LET_SHARE_E2E__.broadcastDiscover()`),
      receiver.evaluate(`window.__LET_SHARE_E2E__.broadcastDiscover()`),
    ]);

    await waitForState(
      sender,
      (state) => state.users.some((user) => user.uniqId === "edge-receiver:p2p-disk"),
      "Chrome sender did not discover Edge receiver"
    );
    await waitForState(
      receiver,
      (state) => state.users.some((user) => user.uniqId === "chrome-sender:p2p-disk"),
      "Edge receiver did not discover Chrome sender"
    );

    await waitForState(
      sender,
      (state) =>
        state.users.some(
          (user) =>
            user.uniqId === "edge-receiver:p2p-disk" &&
            user.status === "connected"
        ),
      () => `P2P data channel did not connect; server=${JSON.stringify(server.output.slice(-60))}`
    );

    await setFileInputFiles(sender, "#multi-file-input", [filePath]);
    await waitForState(
      sender,
      (state) => state.selectedFileName === TEST_FILE_NAME,
      "Chrome sender did not select the oversized sparse file"
    );

    await sender.click(`[data-testid="connected-user"][data-user-id="edge-receiver:p2p-disk"]`);

    const receiverState = await waitForState(
      receiver,
      (state) =>
        state.pendingDirectSaveRequest?.fileName === TEST_FILE_NAME &&
        state.pendingDirectSaveRequest?.fileSize === LARGE_FILE_SIZE,
      "Edge receiver did not show direct-to-disk save request for oversized P2P file"
    );

    assert.equal(receiverState.pendingDirectSaveRequest.peerId, "chrome-sender:p2p-disk");
    assert.equal(
      await receiver.evaluate(`document.querySelector('[data-testid="direct-disk-save-request"]') !== null`),
      true
    );
    assert.deepEqual(receiverState.receivedFiles, []);
    assert.deepEqual(receiverState.directSavedFiles, []);
  }
);

function spawnManaged(t, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [];
  const remember = (stream, prefix) => {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output.push(`${prefix}${chunk}`);
      while (output.length > 200) output.shift();
    });
  };
  remember(child.stdout, "");
  remember(child.stderr, "");
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      output.push(`[process exited: ${command} ${code} ${signal ?? ""}]`);
    }
  });
  t.after(() => killProcess(child));
  return { child, output };
}

function spawnNpmManaged(t, args) {
  if (process.platform === "win32") {
    return spawnManaged(
      t,
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", "npm.cmd", ...args],
      { cwd: process.cwd(), env: process.env }
    );
  }
  return spawnManaged(t, "npm", args, { cwd: process.cwd(), env: process.env });
}

function killProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      const timeout = setTimeout(resolve, 3_000);
      killer.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      killer.on("error", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  child.kill("SIGTERM");
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    child.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function findBrowserExecutable(kind) {
  const candidates = getBrowserCandidates(kind);

  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }

  throw new Error(`No ${kind} executable found for CDP e2e test`);
}

function getBrowserCandidates(kind) {
  const normalized = String(kind || "any").toLowerCase();
  const chromeCandidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
        ];
  const edgeCandidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : [
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/usr/bin/microsoft-edge",
        ];

  if (normalized === "chrome") return chromeCandidates;
  if (normalized === "edge") return edgeCandidates;
  return [...chromeCandidates, ...edgeCandidates];
}

async function openPage({ debugPort, userId, uniqId, transferPriority }) {
  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" }
  );
  assert.equal(response.ok, true, `CDP target creation failed: ${response.status}`);
  const target = await response.json();
  const page = new CdpPage(target.webSocketDebuggerUrl);
  await page.connect();
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("DOM.enable");
  await page.send("Network.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: buildInitScript({ userId, uniqId, transferPriority }),
  });
  return page;
}

function buildInitScript({ userId, uniqId, transferPriority }) {
  const settings = {
    roomId: ROOM_ID,
    userTheme: "light",
    userLanguage: "en",
    serverMode: "custom",
    customServerUrl: SERVER_WS_URL,
    authToken: AUTH_TOKEN,
    ablyKey: "",
    transferPriority,
    version: "3.5.6",
    isNewUser: false,
  };

  return `
    (() => {
      localStorage.setItem("user_settings", ${JSON.stringify(JSON.stringify(settings))});
      localStorage.setItem("memorableState", ${JSON.stringify(
        JSON.stringify({ memorable: { userId, uniqId } })
      )});
    })();
  `;
}

class CdpPage {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleMessages = [];
    this.webSocketFrames = [];
    this.loadResolvers = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
      this.ws.addEventListener("message", (event) => this.handleMessage(event.data));
    });
  }

  async close() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === "Runtime.consoleAPICalled") {
      this.consoleMessages.push({
        type: message.params.type,
        text: message.params.args.map(formatRemoteValue).join(" "),
      });
    }

    if (
      message.method === "Network.webSocketFrameSent" ||
      message.method === "Network.webSocketFrameReceived"
    ) {
      this.webSocketFrames.push({
        direction:
          message.method === "Network.webSocketFrameSent" ? "sent" : "received",
        opcode: message.params.response.opcode,
        payloadData: String(message.params.response.payloadData ?? "").slice(0, 500),
      });
      while (this.webSocketFrames.length > 80) this.webSocketFrames.shift();
    }

    if (message.method === "Runtime.exceptionThrown") {
      this.consoleMessages.push({
        type: "exception",
        text: message.params.exceptionDetails?.text ?? "runtime exception",
      });
    }

    if (message.method === "Page.loadEventFired") {
      const resolvers = this.loadResolvers.splice(0);
      for (const resolve of resolvers) resolve();
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async navigate(url) {
    const loaded = new Promise((resolve) => this.loadResolvers.push(resolve));
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
    }
    return result.result.value;
  }

  async click(selector) {
    const clicked = await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()
    `);
    assert.equal(clicked, true, `Element not found: ${selector}`);
  }
}

function formatRemoteValue(value) {
  if ("value" in value) return String(value.value);
  if (value.description) return value.description;
  return value.type;
}

async function setFileInputFiles(page, selector, files) {
  const { root } = await page.send("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await page.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  assert.notEqual(nodeId, 0, `File input not found: ${selector}`);
  await page.send("DOM.setFileInputFiles", { nodeId, files });
  await page.evaluate(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
}

async function waitForE2EHook(page, label) {
  await poll(
    async () => page.evaluate(`typeof window.__LET_SHARE_E2E__ === "object"`),
    (present) => present === true,
    10_000,
    `${label} did not expose __LET_SHARE_E2E__`
  );
}

async function waitForState(page, predicate, label) {
  return poll(
    async () => page.evaluate(`window.__LET_SHARE_E2E__?.getState()`),
    (state) => state && predicate(state),
    30_000,
    () =>
      `${messageText(label)}; console=${JSON.stringify(
        page.consoleMessages.slice(-30)
      )}; ws=${JSON.stringify(page.webSocketFrames.slice(-30))}`
  );
}

async function poll(read, predicate, timeoutMs, message) {
  const start = Date.now();
  let lastValue;
  while (Date.now() - start < timeoutMs) {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await delay(250);
  }
  throw new Error(`${messageText(message)}; last=${JSON.stringify(lastValue)}`);
}

function messageText(message) {
  return typeof message === "function" ? message() : message;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
