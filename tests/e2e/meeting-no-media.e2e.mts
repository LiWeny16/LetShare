import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

async function until(desc: string, condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await condition()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timeout waiting for ${desc}${lastError ? `: ${String(lastError)}` : ""}`);
}

test("meeting without camera or microphone still joins and keeps meeting controls usable", async (t) => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  t.after(async () => { await browser.close(); });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(({ token, ws }) => {
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: "no-media", uniqId: "no-media:e2e" } }));
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: "e2e-no-media",
      userTheme: "light",
      userLanguage: "zh",
      serverMode: "custom",
      customServerUrl: ws,
      authToken: token,
      ablyKey: "",
      transferPriority: "p2p",
      version: "3.8.4",
      isNewUser: false,
      meetingCameraDefaultOn: false,
      meetingMicrophoneDefaultOn: false,
    }));

    // Deterministic no-device environment: both capture APIs fail as a real browser
    // does when no input device exists. The meeting must still join in receive-only mode.
    const media = navigator.mediaDevices;
    if (media) {
      media.getUserMedia = async () => {
        throw new DOMException("Requested device not found", "NotFoundError");
      };
      media.enumerateDevices = async () => [];
    }

    // Keep the publish transport from reaching its media-connected callback. A
    // successful meeting join must be observable from the server acknowledgement,
    // not gated on local devices or a later WebRTC state transition.
    const NativePeerConnection = window.RTCPeerConnection;
    if (NativePeerConnection) {
      window.RTCPeerConnection = class extends NativePeerConnection {
        get connectionState() { return "new" as RTCPeerConnectionState; }
      } as typeof RTCPeerConnection;
    }
  }, { token: TOKEN, ws: WS });

  const page = await context.newPage();
  const consoleLines: string[] = [];
  page.on("console", (message) => {
    const line = `[${message.type()}] ${message.text()}`;
    consoleLines.push(line);
    if (/meeting|sdp|ice|error|Error/i.test(line)) console.log(line.slice(0, 260));
  });
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message.slice(0, 260)}`));

  await page.goto(`${SITE}/?room=e2e-no-media#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await page.locator('button[aria-label="plus"]:visible').first().click();
  await page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await page.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: /开始会议|Start meeting/ }).click();

  await until("meeting route", async () => (await page.evaluate(() => location.hash)).includes("/meeting"), 20_000);
  await until("server-confirmed in-meeting state without local media", async () =>
    (await page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 30_000);

  const state = await page.evaluate(() => (window as any).__meeting?.getState?.());
  const stage = page.getByTestId("meeting-stage");
  assert.equal(await stage.getAttribute("data-stage"), "in-meeting");
  assert.equal(await stage.getAttribute("data-media-error"), "not-found");
  if (state) {
    assert.equal(state.stage, "in-meeting");
    assert.equal(state.mediaError, "not-found");
    assert.equal(state.cameraOn, false);
    assert.equal(state.muted, true);
  }

  for (const label of [
    /解除静音|Unmute/,
    /开启摄像头|Start video|Turn on camera/,
    /共享屏幕|Share screen/,
    /白板|Whiteboard/,
  ]) {
    const button = page.getByRole("button", { name: label }).first();
    await button.waitFor({ state: "visible", timeout: 5_000 });
    assert.equal(await button.isDisabled(), false, `${String(label)} must remain usable`);
  }

  assert.match(consoleLines.join("\n"), /NotFoundError|not found/i);
});
