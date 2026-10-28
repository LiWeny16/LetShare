import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const site = process.env.E2E_SITE ?? "http://127.0.0.1:27772";
const ws = process.env.E2E_WS ?? "ws://127.0.0.1:27771/";
const token = createHash("sha256").update("sever_auth_123").digest("hex");
const source = `compat${Date.now().toString(36).slice(-6)}`;

async function until(label: string, check: () => Promise<boolean>, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* navigation can replace the document */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function client(executablePath: string, name: string, pendingMic = false, dropJoinSignals = false, dropAllJoinSignals = false, legacyRtc = false, brokenRtc = false): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await chromium.launch({ executablePath, headless: false, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  await context.addInitScript(({ name, source, ws, token, pendingMic, dropJoinSignals, dropAllJoinSignals, legacyRtc, brokenRtc }) => {
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: name, userName: name, userNameExplicit: true, uniqId: `${name}:join-compat` } }));
    localStorage.setItem("user_settings", JSON.stringify({ roomId: source, userTheme: "light", userLanguage: "zh", serverMode: "custom", customServerUrl: ws, authToken: token, ablyKey: "", transferPriority: "p2p", version: "3.9.0", isNewUser: false, meetingCameraDefaultOn: false, meetingMicrophoneDefaultOn: pendingMic }));
    if (pendingMic) {
      (window as any).__captureCalls = 0;
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (constraints) => {
        if (!constraints.audio) return original(constraints);
        (window as any).__captureCalls++;
        return new Promise<MediaStream>(() => {});
      };
    }
    if (legacyRtc) {
      const nativeCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (navigator as any).webkitGetUserMedia = (constraints: MediaStreamConstraints, success: (stream: MediaStream) => void, failure: (error: unknown) => void) => {
        void nativeCapture(constraints).then(success, failure);
      };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: undefined });
      const Native = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Native {
        constructor(config?: RTCConfiguration) {
          super(config);
          Object.defineProperty(this, "addTransceiver", { value: undefined });
          Object.defineProperty(this, "getTransceivers", { value: undefined });
          Object.defineProperty(this, "connectionState", { value: undefined });
        }
      };
    }
    if (brokenRtc) {
      const Native = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Native {
        constructor(config?: RTCConfiguration) {
          super(config);
          Object.defineProperty(this, "createDataChannel", { value: undefined });
        }
        addTransceiver(): RTCRtpTransceiver { throw new DOMException("simulated unavailable", "NotSupportedError"); }
      };
    }
    if (dropJoinSignals) {
      const NativeWebSocket = window.WebSocket;
      const dropped = new Set<string>();
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args, newTarget) {
          const socket = Reflect.construct(target, args, newTarget) as WebSocket;
          socket.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            try {
              const message = JSON.parse(event.data);
              const type = message.type;
              if ((type === "meeting:info" || type === "meeting:membership:snapshot") && (dropAllJoinSignals || !dropped.has(type))) {
                dropped.add(type);
                event.stopImmediatePropagation();
              }
            } catch { /* ignore non-JSON traffic */ }
          });
          return socket;
        },
      }) as typeof WebSocket;
    }
  }, { name, source, ws, token, pendingMic, dropJoinSignals, dropAllJoinSignals, legacyRtc, brokenRtc });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`[${name}] pageerror ${error.message}`));
  page.on("console", (message) => { if (/meeting|服务器错误|会议不存在/i.test(message.text())) console.log(`[${name}] ${message.text()}`); });
  return { browser, context, page };
}

test("real Edge and Chrome join, pending microphone, and missing meeting", async (t) => {
  const edge = await client("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "compat-edge");
  const chrome = await client("C:/Program Files/Google/Chrome/Application/chrome.exe", "compat-chrome", true, true);
  t.after(async () => { await Promise.allSettled([edge.browser.close(), chrome.browser.close()]); });
  await edge.page.goto(`${site}/?room=${source}#`, { waitUntil: "domcontentloaded" });
  await edge.page.locator('button[aria-label="plus"]:visible').first().click({ timeout: 30000 });
  await edge.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await edge.page.getByText("MEETING PASS", { exact: true }).waitFor({ timeout: 15000 });
  await edge.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Join meeting/ }).click();
  await until("host joined", async () => (await edge.page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");
  const id = await edge.page.evaluate(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("room"));
  assert.match(id ?? "", /^\d{4}$/);
  await chrome.page.goto(`${site}/#/meeting?room=${id}&source=${source}`, { waitUntil: "domcontentloaded" });
  await until("host sees guest", async () => edge.page.evaluate(() => (window as any).__meeting?.getState().members.some((member: any) => member.uniqId === "compat-chrome:join-compat")));
  assert.equal(await chrome.page.getByTestId("meeting-stage").getAttribute("data-stage"), "joining", "dropped acknowledgement reproduces a visible but stuck participant");
  assert.equal(await chrome.page.evaluate(() => (window as any).__meeting?.getState().members.length), 0);
  await until("guest recovers join after missed acknowledgement", async () => (await chrome.page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 20000);
  await until("guest sees host after retry", async () => chrome.page.evaluate(() => (window as any).__meeting?.getState().members.some((member: any) => member.uniqId === "compat-edge:join-compat")));
  await chrome.page.getByText(/^00:0[1-9]$/).first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await chrome.page.getByText(/正在请求麦克风|正在检查媒体设备/).count(), 0, "pending permission should not show an app banner");
  await edge.page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("microphone denied", "NotAllowedError"); };
  });
  await edge.page.getByRole("button", { name: /解除静音|Unmute/ }).first().click();
  await edge.page.getByTestId("meeting-microphone-error").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await edge.page.getByTestId("meeting-microphone-retry").isEnabled(), true, "actual capture failures retain retry UI");
  const stuck = await client("C:/Program Files/Google/Chrome/Application/chrome.exe", "compat-timeout", true, true, true);
  t.after(() => stuck.browser.close());
  await stuck.page.goto(`${site}/#/meeting?room=${id}&source=${source}`, { waitUntil: "domcontentloaded" });
  await until("host sees unacknowledged guest", async () => edge.page.evaluate(() => (window as any).__meeting?.getState().members.some((member: any) => member.uniqId === "compat-timeout:join-compat")));
  await stuck.page.getByTestId("meeting-unavailable").waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await stuck.page.getByTestId("meeting-not-found").count(), 0, "missing acknowledgement is not evidence that the meeting does not exist");
  await until("unacknowledged guest is removed", async () => edge.page.evaluate(() => !(window as any).__meeting?.getState().members.some((member: any) => member.uniqId === "compat-timeout:join-compat")));
  await chrome.page.goto(`${site}/#/meeting?room=invalid`, { waitUntil: "domcontentloaded" });
  await chrome.page.getByTestId("meeting-not-found").waitFor({ state: "visible", timeout: 8000 });
  assert.equal(await chrome.page.getByTestId("meeting-stage").count(), 0);
  await chrome.page.goto(`${site}/#/meeting?room=0000`, { waitUntil: "domcontentloaded" });
  await chrome.page.getByTestId("meeting-not-found").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await chrome.page.getByTestId("meeting-stage").count(), 0);
  await chrome.page.goto(`${site}/#/meeting?room=0000B1`, { waitUntil: "domcontentloaded" });
  await chrome.page.getByTestId("meeting-not-found").waitFor({ state: "visible", timeout: 15000 }).catch(async (error) => {
    console.log("breakout missing diagnostics", await chrome.page.evaluate(() => { const s = (window as any).__meeting?.getState(); return { stage: s?.stage, roomId: s?.roomId, error: s?.meetingError, text: document.body.innerText.slice(0, 400) }; }));
    throw error;
  });
  assert.equal(await chrome.page.getByTestId("meeting-stage").count(), 0);
  console.log(`Edge host and Chrome guest joined room ${id}; dropped initial join frames recovered while microphone permission remained pending`);
});

test("older WebRTC fallback publishes and receives audio; timeout and initialization failures recover", async (t) => {
  const edge = await client("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "legacy-host");
  const legacy = await client("C:/Program Files/Google/Chrome/Application/chrome.exe", "legacy-guest", false, false, false, true);
  t.after(async () => { await Promise.allSettled([edge.browser.close(), legacy.browser.close()]); });
  await edge.page.goto(`${site}/?room=${source}#`, { waitUntil: "domcontentloaded" });
  await edge.page.locator('button[aria-label="plus"]:visible').first().click({ timeout: 30000 });
  await edge.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await edge.page.getByText("MEETING PASS", { exact: true }).waitFor({ timeout: 15000 });
  await edge.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Join meeting/ }).click();
  await until("legacy host joined", async () => edge.page.evaluate(() => (window as any).__meeting?.getState().stage === "in-meeting"));
  const id = await edge.page.evaluate(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("room"));
  await legacy.page.goto(`${site}/#/meeting?room=${id}&source=${source}`, { waitUntil: "domcontentloaded" });
  await until("legacy guest joined", async () => legacy.page.evaluate(() => (window as any).__meeting?.getState().stage === "in-meeting"));
  await legacy.page.getByRole("button", { name: /解除静音|Unmute/ }).first().click();
  await edge.page.getByRole("button", { name: /解除静音|Unmute/ }).first().click();
  await until("host receives legacy guest audio", async () => edge.page.evaluate(() => (window as any).__meeting?.getState().remoteTracks.some((item: any) => item.uniqId === "legacy-guest:join-compat" && item.kind === "audio")));
  await until("legacy guest receives host audio", async () => legacy.page.evaluate(() => (window as any).__meeting?.getState().remoteTracks.some((item: any) => item.uniqId === "legacy-host:join-compat" && item.kind === "audio")));
  const pending = await client("C:/Program Files/Google/Chrome/Application/chrome.exe", "pending-guest", true);
  t.after(() => pending.browser.close());
  await pending.page.goto(`${site}/#/meeting?room=${id}&source=${source}`, { waitUntil: "domcontentloaded" });
  await pending.page.getByTestId("meeting-microphone-error").waitFor({ state: "visible", timeout: 25000 });
  assert.equal(await pending.page.evaluate(() => (window as any).__meeting.getState().stage), "in-meeting");
  await pending.page.getByTestId("meeting-microphone-retry").click();
  await until("new microphone request is not blocked by old pending request", async () => pending.page.evaluate(() => (window as any).__captureCalls >= 2));
  const broken = await client("C:/Program Files/Google/Chrome/Application/chrome.exe", "broken-guest", false, false, false, false, true);
  t.after(() => broken.browser.close());
  await broken.page.goto(`${site}/#/meeting?room=${id}&source=${source}`, { waitUntil: "domcontentloaded" });
  await broken.page.getByText("当前浏览器不支持会议").waitFor({ state: "visible", timeout: 15000 });
  await until("failed guest removed from host", async () => edge.page.evaluate(() => !(window as any).__meeting?.getState().members.some((member: any) => member.uniqId === "broken-guest:join-compat")));
});
