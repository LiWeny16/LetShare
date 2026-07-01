const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const {
  accessSync,
  existsSync,
  mkdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} = require("node:fs");
const { join, resolve } = require("node:path");

let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch (error) {
  console.error(
    "Missing playwright-core. Run with NODE_PATH pointing at a temporary install, for example:\n" +
      "  npm --prefix %TEMP%\\letshare-playwright install --no-save playwright-core\n" +
      "  set NODE_PATH=%TEMP%\\letshare-playwright\\node_modules\n" +
      "  node scripts/public-relay-stability-playwright.cjs"
  );
  process.exit(1);
}

const AUTH_TOKEN =
  "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652";
const PUBLIC_WS_URL = process.env.PUBLIC_WS_URL || "wss://ecs.letshare.fun/ws";
const PUBLIC_HEALTH_URL =
  process.env.PUBLIC_HEALTH_URL || "https://ecs.letshare.fun/health";
const PRO_INVITE_CODE = process.env.PRO_INVITE_CODE || "bigonion";
const SIZES_MB = parseSizes(process.env.SIZES_MB || "0.25,5,20,55");
const ITERATIONS = parsePositiveInt(process.env.ITERATIONS || "1", "ITERATIONS");
const RECEIVER_DOWNLOAD_KB_PER_SEC = parseOptionalPositiveNumber(
  process.env.RECEIVER_DOWNLOAD_KB_PER_SEC,
  "RECEIVER_DOWNLOAD_KB_PER_SEC"
);
const PORT_BASE = 22_000 + Math.floor(Math.random() * 20_000);
const FRONTEND_PORT = parsePositiveInt(
  process.env.FRONTEND_PORT || String(PORT_BASE),
  "FRONTEND_PORT"
);
const APP_URL =
  process.env.APP_URL || `http://127.0.0.1:${FRONTEND_PORT}/`;
const USE_LOCAL_FRONTEND = !process.env.APP_URL;
const ROOM_ID = `pw${Date.now().toString(36).slice(-8)}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const ARTIFACT_ROOT = resolve(".tmp", `public-relay-stability-${RUN_ID}`);
const FILE_ROOT = join(ARTIFACT_ROOT, "files");

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});

async function main() {
  mkdirSync(FILE_ROOT, { recursive: true });

  console.log("[config]", {
    appUrl: APP_URL,
    publicWsUrl: PUBLIC_WS_URL,
    publicHealthUrl: PUBLIC_HEALTH_URL,
    roomId: ROOM_ID,
    sizesMb: SIZES_MB,
    iterations: ITERATIONS,
    receiverDownloadKBPerSec: RECEIVER_DOWNLOAD_KB_PER_SEC,
    artifacts: ARTIFACT_ROOT,
  });

  const processes = [];
  let browser;
  const results = [];

  try {
    await waitForHttp(PUBLIC_HEALTH_URL, 30_000);

    if (USE_LOCAL_FRONTEND) {
      const frontend = spawnNpmManaged([
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        String(FRONTEND_PORT),
        "--strictPort",
      ]);
      processes.push(frontend);
      await waitForHttp(APP_URL, 30_000);
    }

    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true,
      args: [
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    const receiver = await createClient(browser, {
      userId: "receiver",
      uniqId: "receiver:public-relay",
    });
    if (RECEIVER_DOWNLOAD_KB_PER_SEC) {
      await throttleReceiverDownload(receiver, RECEIVER_DOWNLOAD_KB_PER_SEC);
    }
    const sender = await createClient(browser, {
      userId: "sender",
      uniqId: "sender:public-relay",
    });

    const appWithRoom = `${APP_URL}?room=${encodeURIComponent(ROOM_ID)}&region=china`;
    await Promise.all([
      receiver.page.goto(appWithRoom, { waitUntil: "domcontentloaded" }),
      sender.page.goto(appWithRoom, { waitUntil: "domcontentloaded" }),
    ]);

    await Promise.all([
      waitForE2EHook(receiver, "receiver"),
      waitForE2EHook(sender, "sender"),
    ]);
    await Promise.all([
      waitForState(
        receiver,
        (state) => state.isConnectedToServer === true,
        "receiver did not connect to public server",
        30_000
      ),
      waitForState(
        sender,
        (state) => state.isConnectedToServer === true,
        "sender did not connect to public server",
        30_000
      ),
    ]);

    await Promise.all([
      sender.page.evaluate(() => window.__LET_SHARE_E2E__.broadcastDiscover()),
      receiver.page.evaluate(() => window.__LET_SHARE_E2E__.broadcastDiscover()),
    ]);
    await waitForState(
      sender,
      (state) => state.users.some((user) => user.uniqId === "receiver:public-relay"),
      "sender did not discover receiver",
      30_000
    );
    await waitForState(
      receiver,
      (state) => state.users.some((user) => user.uniqId === "sender:public-relay"),
      "receiver did not discover sender",
      30_000
    );

    for (let iteration = 1; iteration <= ITERATIONS; iteration++) {
      for (const sizeMb of SIZES_MB) {
        const result = await runTransferCase({
          sender,
          receiver,
          sizeMb,
          iteration,
        });
        results.push(result);
        console.log(
          `[case] ${result.ok ? "PASS" : "FAIL"} ${result.fileName} ` +
            `${result.sizeMb}MB ${result.durationMs}ms ${result.message || ""}`
        );
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await Promise.allSettled(processes.map((child) => killProcess(child)));
    rmSync(FILE_ROOT, { recursive: true, force: true });
  }

  const report = {
    runId: RUN_ID,
    appUrl: APP_URL,
    publicWsUrl: PUBLIC_WS_URL,
    roomId: ROOM_ID,
    sizesMb: SIZES_MB,
    iterations: ITERATIONS,
    receiverDownloadKBPerSec: RECEIVER_DOWNLOAD_KB_PER_SEC,
    results,
  };
  const reportPath = join(ARTIFACT_ROOT, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[report] ${reportPath}`);

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function createClient(browser, { userId, uniqId }) {
  const diagnostics = {
    console: [],
    pageErrors: [],
    requestFailures: [],
    wsFrames: [],
  };
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(
    ({ settings, memorable, proInviteCode }) => {
      Object.defineProperty(window, "RTCPeerConnection", {
        value: undefined,
        configurable: true,
      });
      Object.defineProperty(window, "webkitRTCPeerConnection", {
        value: undefined,
        configurable: true,
      });
      localStorage.setItem("user_settings", JSON.stringify(settings));
      localStorage.setItem("memorableState", JSON.stringify({ memorable }));
      document.cookie = `letshare_admin_pass=${encodeURIComponent(
        proInviteCode
      )};path=/;SameSite=Lax`;
    },
    {
      settings: {
        roomId: ROOM_ID,
        userTheme: "light",
        userLanguage: "en",
        serverMode: "custom",
        customServerUrl: PUBLIC_WS_URL,
        authToken: AUTH_TOKEN,
        ablyKey: "",
        transferPriority: "server",
        version: "3.4.2",
        isNewUser: false,
      },
      memorable: { userId, uniqId },
      proInviteCode: PRO_INVITE_CODE,
    }
  );
  const page = await context.newPage();
  attachDiagnostics(page, diagnostics);
  return { context, page, diagnostics, userId, uniqId };
}

async function throttleReceiverDownload(client, downloadKBPerSec) {
  const cdp = await client.context.newCDPSession(client.page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 80,
    downloadThroughput: Math.max(1, Math.floor(downloadKBPerSec * 1024)),
    uploadThroughput: -1,
    connectionType: "cellular3g",
  });
  client.diagnostics.networkThrottle = {
    downloadKBPerSec,
    appliedAt: Date.now(),
  };
}

async function runTransferCase({ sender, receiver, sizeMb, iteration }) {
  const sizeBytes = Math.max(1, Math.round(sizeMb * 1024 * 1024));
  const sizeLabel = String(sizeMb).replace(/\./g, "p");
  const fileName = `relay-i${iteration}-${sizeLabel}mb-${Date.now()}.bin`;
  const filePath = join(FILE_ROOT, fileName);
  mkdirSync(FILE_ROOT, { recursive: true });
  writeFileSync(filePath, "");
  truncateSync(filePath, sizeBytes);
  const startedAt = Date.now();
  const throttleTimeoutMs = RECEIVER_DOWNLOAD_KB_PER_SEC
    ? Math.ceil((sizeBytes / (RECEIVER_DOWNLOAD_KB_PER_SEC * 1024)) * 1000 * 20) +
      60_000
    : 0;
  const timeoutMs = Math.max(
    120_000,
    Math.ceil(sizeMb * 12_000),
    throttleTimeoutMs
  );

  try {
    await sender.page.setInputFiles("#multi-file-input", filePath);
    await waitForState(
      sender,
      (state) => state.selectedFileName === fileName,
      `sender did not select ${fileName}`,
      10_000
    );

    await domClick(
      sender.page,
      `[data-testid="connected-user"][data-user-id="receiver:public-relay"]`
    );

    await Promise.allSettled([
      waitForHistory(
        sender,
        (history) => history.dom.some((entry) => entry.sendVisible === true),
        "sender upload progress UI did not render",
        15_000
      ),
      waitForHistory(
        receiver,
        (history) => history.dom.some((entry) => entry.receiveVisible === true),
        "receiver download progress UI did not render",
        15_000
      ),
    ]);

    const receiverState = await waitForState(
      receiver,
      (state) =>
        state.receivedFiles.some(
          (file) => file.name === fileName && file.size === sizeBytes
        ),
      `receiver did not receive ${fileName}`,
      timeoutMs
    );
    const senderState = await waitForState(
      sender,
      (state) =>
        state.sentFiles.some(
          (file) =>
            file.name === fileName && file.toUserId === "receiver:public-relay"
        ),
      `sender did not record sent file ${fileName}`,
      timeoutMs
    );
    await waitForState(
      sender,
      (state) => state.hasActiveOutgoingFileTransfer === false,
      `sender still has active outgoing transfer after ${fileName}`,
      20_000
    );

    assert.equal(receiverState.fileTransferStatus.kind, "success");
    assert.equal(senderState.fileTransferStatus.kind, "success");

    const senderHistory = await getHistory(sender);
    const receiverHistory = await getHistory(receiver);
    const badMessages = findBadMessages([sender, receiver], startedAt);
    assert.deepEqual(badMessages, []);

    return {
      ok: true,
      iteration,
      sizeMb,
      sizeBytes,
      fileName,
      durationMs: Date.now() - startedAt,
      senderMaxProgress: maxProgress(senderHistory, true),
      receiverMaxProgress: maxProgress(receiverHistory, false),
      senderWsFrames: summarizeWs(sender.diagnostics, startedAt),
      receiverWsFrames: summarizeWs(receiver.diagnostics, startedAt),
    };
  } catch (error) {
    const senderState = await safeGetState(sender);
    const receiverState = await safeGetState(receiver);
    const screenshotBase = join(
      ARTIFACT_ROOT,
      `failure-i${iteration}-${sizeLabel}mb`
    );
    await Promise.allSettled([
      sender.page.screenshot({ path: `${screenshotBase}-sender.png`, fullPage: true }),
      receiver.page.screenshot({
        path: `${screenshotBase}-receiver.png`,
        fullPage: true,
      }),
    ]);
    return {
      ok: false,
      iteration,
      sizeMb,
      sizeBytes,
      fileName,
      durationMs: Date.now() - startedAt,
      message: error?.message || String(error),
      senderState,
      receiverState,
      senderDiagnostics: sliceDiagnostics(sender.diagnostics, startedAt),
      receiverDiagnostics: sliceDiagnostics(receiver.diagnostics, startedAt),
      screenshots: [`${screenshotBase}-sender.png`, `${screenshotBase}-receiver.png`],
    };
  }
}

function attachDiagnostics(page, diagnostics) {
  page.on("console", (message) => {
    remember(diagnostics.console, {
      at: Date.now(),
      type: message.type(),
      text: message.text(),
    });
  });
  page.on("pageerror", (error) => {
    remember(diagnostics.pageErrors, {
      at: Date.now(),
      message: error.message,
      stack: error.stack,
    });
  });
  page.on("requestfailed", (request) => {
    remember(diagnostics.requestFailures, {
      at: Date.now(),
      url: request.url(),
      failure: request.failure()?.errorText,
    });
  });
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      remember(diagnostics.wsFrames, summarizeFrame(Date.now(), "sent", ws.url(), frame));
    });
    ws.on("framereceived", (frame) => {
      remember(
        diagnostics.wsFrames,
        summarizeFrame(Date.now(), "received", ws.url(), frame)
      );
    });
    ws.on("close", () => {
      remember(diagnostics.wsFrames, { at: Date.now(), direction: "close", url: ws.url() });
    });
  });
}

function summarizeFrame(at, direction, url, frame) {
  const payload = frame.payload;
  if (typeof payload === "string") {
    return {
      at,
      direction,
      url,
      kind: "text",
      sample: payload.slice(0, 260),
      bytes: Buffer.byteLength(payload),
    };
  }
  const bytes = payload?.byteLength ?? payload?.length ?? 0;
  return { at, direction, url, kind: "binary", bytes };
}

function remember(list, entry) {
  list.push(entry);
  while (list.length > 500) list.shift();
}

async function waitForE2EHook(client, label) {
  await poll(
    () => client.page.evaluate(() => typeof window.__LET_SHARE_E2E__ === "object"),
    (present) => present === true,
    20_000,
    `${label} did not expose __LET_SHARE_E2E__; use local Vite dev frontend`
  );
}

async function waitForState(client, predicate, label, timeoutMs) {
  return poll(
    () => client.page.evaluate(() => window.__LET_SHARE_E2E__?.getState()),
    (state) => state && predicate(state),
    timeoutMs,
    () =>
      `${label}; diagnostics=${JSON.stringifySafe(
        sliceDiagnostics(client.diagnostics, Date.now() - 30_000)
      )}`
  );
}

async function waitForHistory(client, predicate, label, timeoutMs) {
  return poll(
    () => client.page.evaluate(() => window.__LET_SHARE_E2E__?.getHistory()),
    (history) => history && predicate(history),
    timeoutMs,
    label
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
  throw new Error(`${messageText(message)}; last=${JSON.stringifySafe(lastValue)}`);
}

async function getHistory(client) {
  return client.page.evaluate(() => window.__LET_SHARE_E2E__?.getHistory());
}

async function domClick(page, selector) {
  const clicked = await page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) return false;
    element.click();
    return true;
  }, selector);
  assert.equal(clicked, true, `Element not found: ${selector}`);
}

async function safeGetState(client) {
  try {
    return await client.page.evaluate(() => window.__LET_SHARE_E2E__?.getState());
  } catch (error) {
    return { error: error.message };
  }
}

function maxProgress(history, outgoing) {
  return Math.max(
    -1,
    ...((history?.progress || [])
      .filter((entry) => entry.outgoing === outgoing)
      .map((entry) => Number(entry.value)) || [])
  );
}

function findBadMessages(clients, since) {
  const badPattern =
    /task is in process|taskInProgress|task in progress|missing chunks|chunkWithoutTransfer|receive session|transfer id is required|malformed|abnormal|传输失败|文件传输错误|公网传输中断|接收会话不存在|缺失分片/i;
  const messages = [];
  for (const client of clients) {
    for (const entry of [
      ...client.diagnostics.console,
      ...client.diagnostics.pageErrors,
      ...client.diagnostics.requestFailures,
    ]) {
      if (entry.at < since) continue;
      const text = entry.text || entry.message || entry.failure || "";
      if (badPattern.test(text)) messages.push(entry);
    }
  }
  return messages;
}

function sliceDiagnostics(diagnostics, since) {
  return {
    console: diagnostics.console.filter((entry) => entry.at >= since).slice(-80),
    pageErrors: diagnostics.pageErrors.filter((entry) => entry.at >= since).slice(-40),
    requestFailures: diagnostics.requestFailures
      .filter((entry) => entry.at >= since)
      .slice(-40),
    wsFrames: diagnostics.wsFrames.filter((entry) => entry.at >= since).slice(-80),
  };
}

function summarizeWs(diagnostics, since) {
  const frames = diagnostics.wsFrames.filter((entry) => entry.at >= since);
  return {
    sentText: frames.filter((frame) => frame.direction === "sent" && frame.kind === "text")
      .length,
    receivedText: frames.filter(
      (frame) => frame.direction === "received" && frame.kind === "text"
    ).length,
    sentBinary: frames.filter(
      (frame) => frame.direction === "sent" && frame.kind === "binary"
    ).length,
    receivedBinary: frames.filter(
      (frame) => frame.direction === "received" && frame.kind === "binary"
    ).length,
  };
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
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function spawnNpmManaged(args) {
  if (process.platform === "win32") {
    return spawnManaged(process.env.ComSpec || "cmd.exe", [
      "/d",
      "/s",
      "/c",
      "npm.cmd",
      ...args,
    ]);
  }
  return spawnManaged("npm", args);
}

function spawnManaged(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => process.stdout.write(`[frontend] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[frontend] ${chunk}`));
  return child;
}

function killProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolveKill) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      const timeout = setTimeout(resolveKill, 3_000);
      killer.on("exit", () => {
        clearTimeout(timeout);
        resolveKill();
      });
      killer.on("error", () => {
        clearTimeout(timeout);
        resolveKill();
      });
    });
  }
  child.kill("SIGTERM");
  return new Promise((resolveKill) => {
    const timeout = setTimeout(resolveKill, 3_000);
    child.on("exit", () => {
      clearTimeout(timeout);
      resolveKill();
    });
  });
}

function findBrowserExecutable() {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/usr/bin/microsoft-edge",
        ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("No Chrome/Edge executable found");
}

function parseSizes(value) {
  const sizes = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number) && number > 0);
  if (sizes.length === 0) {
    throw new Error(`Invalid SIZES_MB: ${value}`);
  }
  return sizes;
}

function parsePositiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function parseOptionalPositiveNumber(value, name) {
  if (value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return number;
}

function messageText(message) {
  return typeof message === "function" ? message() : message;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

JSON.stringifySafe = function stringifySafe(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
};
