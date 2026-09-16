import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting for ${desc}${lastError ? `: ${String(lastError)}` : ""}`);
}

async function configurePage(page: Page, userId: string, roomId: string): Promise<void> {
  await page.addInitScript(({ token, ws, userId, roomId }) => {
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId, uniqId: `${userId}:e2e` } }));
    localStorage.setItem("user_settings", JSON.stringify({
      roomId,
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
  }, { token: TOKEN, ws: WS, userId, roomId });

  // Use a content string because Playwright serializes function callbacks. This
  // keeps the fake Web Speech API valid in the browser realm and deterministic.
  const fakeUserId = JSON.stringify(userId);
  await page.addInitScript({ content: `(() => {
    function E2EInjectedSpeechRecognition() {
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 1;
      this.lang = "zh-CN";
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.stopped = false;
    }
    E2EInjectedSpeechRecognition.prototype.start = function () {
      this.stopped = false;
      window.__fakeSpeechStarts = (window.__fakeSpeechStarts || 0) + 1;
      var recognition = this;
      window.setTimeout(function () {
        if (recognition.stopped) return;
        window.__fakeSpeechResults = (window.__fakeSpeechResults || 0) + 1;
        if (recognition.onresult) recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "e2e transcript from " + ${fakeUserId} }, length: 1 }] });
      }, 120);
    };
    E2EInjectedSpeechRecognition.prototype.stop = function () { this.stopped = true; if (this.onend) this.onend(); };
    E2EInjectedSpeechRecognition.prototype.abort = function () { this.stopped = true; };
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, writable: true, value: E2EInjectedSpeechRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, writable: true, value: E2EInjectedSpeechRecognition });
  })();` });
}

test("distributed meeting minutes requires consent and broadcasts real final segments", async (t) => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  t.after(async () => { await browser.close(); });

  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostContext.newPage();
  const member = await memberContext.newPage();
  await configurePage(host, "ai-host", "4321");
  await configurePage(member, "ai-member", "4321");
  const errors: string[] = [];
  for (const page of [host, member]) {
    page.on("pageerror", (error) => errors.push(`${page === host ? "host" : "member"}: ${error.message}`));
    page.on("console", (message) => {
      // TURN is intentionally disabled in the local server profile and its
      // documented JSON 404 is a clean STUN fallback, not an app failure.
      if (message.type() === "error" && !/Failed to load resource: the server responded with a status of 404/i.test(message.text())) {
        errors.push(`${page === host ? "host" : "member"}: ${message.text()}`);
      }
    });
  }

  await host.goto(`${SITE}/?room=4321#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await host.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await host.locator('button[aria-label="plus"]:visible').first().click();
  await host.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await host.getByRole("button", { name: /开始会议|进入会议|Start meeting|Join meeting/ }).click();
  const hostNameGate = host.getByTestId("meeting-name-gate");
  if (await hostNameGate.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await host.getByTestId("meeting-name-input").fill("AI minutes host");
    await host.getByRole("button", { name: /进入会议|Enter meeting/ }).last().click();
  }
  await until("host in-meeting", async () => (await host.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");

  const meetingId = await host.evaluate(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("room"));
  assert.match(meetingId ?? "", /^\d{4}$/);

  await member.goto(`${SITE}/#/meeting?room=${meetingId}&source=4321`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const memberNameGate = member.getByTestId("meeting-name-gate");
  if (await memberNameGate.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await member.getByTestId("meeting-name-input").fill("AI minutes member");
    await member.getByRole("button", { name: /进入会议|Enter meeting/ }).last().click();
  }
  await until("member in-meeting", async () => (await member.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");

  await host.getByTestId("meeting-ai-minutes-open").click();
  await host.getByTestId("meeting-ai-minutes-workspace").waitFor({ state: "visible" });
  if (process.env.E2E_SCREENSHOT) await host.screenshot({ path: process.env.E2E_SCREENSHOT, fullPage: false });
  await host.getByRole("tab", { name: "AI 纪要" }).click();
  await host.getByText("AI 会议纪要详情见左边").waitFor({ state: "visible" });
  await host.getByRole("button", { name: "纪要设置" }).click();
  if (process.env.E2E_SETTINGS_SCREENSHOT) await host.screenshot({ path: process.env.E2E_SETTINGS_SCREENSHOT, fullPage: false });
  await host.getByRole("button", { name: "测试并连接" }).click();
  await host.getByTestId("meeting-minutes-start").click();

  // This assertion must use the real production surface.  __meeting is a
  // dev-only diagnostic hook and is intentionally absent from the deployed
  // bundle; the consent dialog is the member-visible proof that the running
  // state was received and rendered.
  await member.getByTestId("meeting-minutes-consent-dialog").waitFor({ state: "visible", timeout: 15_000 });
  await member.getByTestId("meeting-minutes-consent-accept").click();
  await member.getByTestId("meeting-minutes-consent-dialog").waitFor({ state: "hidden", timeout: 10_000 });

  await until("host receives both final transcript segments", async () => {
    const text = await host.getByTestId("meeting-minutes-segment-count").innerText();
    return text.trim() === "2";
  }, 20_000);
  await host.getByTestId("meeting-minutes-stop").click();
  await until("member consent prompt closes after stop", async () => !(await member.getByTestId("meeting-minutes-consent-dialog").isVisible().catch(() => false)));
  await host.getByTestId("meeting-ai-minutes-workspace").waitFor({ state: "visible", timeout: 10_000 });
  if (process.env.E2E_WORKSPACE_SCREENSHOT) await host.screenshot({ path: process.env.E2E_WORKSPACE_SCREENSHOT, fullPage: false });
  assert.equal(await host.getByRole("button", { name: "返回会议" }).count(), 0);
  await host.getByRole("button", { name: "关闭会议纪要" }).click();
  await host.getByTestId("meeting-ai-minutes-workspace").waitFor({ state: "hidden", timeout: 10_000 });
  await host.getByTestId("meeting-ai-minutes-open").click();
  await host.getByTestId("meeting-ai-minutes-workspace").waitFor({ state: "visible", timeout: 10_000 });
  await host.getByTestId("meeting-ai-minutes-open").click();
  await host.getByTestId("meeting-ai-minutes-workspace").waitFor({ state: "hidden", timeout: 10_000 });
  const panel = host.getByTestId("meeting-panel");
  const separator = host.getByRole("separator", { name: "调整面板宽度" });
  const initialPanelWidth = (await panel.boundingBox())?.width ?? 0;
  const separatorBox = await separator.boundingBox();
  assert.ok(separatorBox, "panel resize handle should be visible");
  await host.mouse.move(separatorBox!.x + 4, separatorBox!.y + separatorBox!.height / 2);
  await host.mouse.down();
  await host.mouse.move(separatorBox!.x + 48, separatorBox!.y + separatorBox!.height / 2, { steps: 4 });
  await host.mouse.up();
  await until("panel width changes by drag", async () => ((await panel.boundingBox())?.width ?? 0) < initialPanelWidth - 40);
  const resizedSeparatorBox = await separator.boundingBox();
  assert.ok(resizedSeparatorBox, "panel resize handle should remain visible");
  await host.mouse.move(resizedSeparatorBox!.x + 4, resizedSeparatorBox!.y + resizedSeparatorBox!.height / 2);
  await host.mouse.down();
  await host.mouse.move(resizedSeparatorBox!.x + 500, resizedSeparatorBox!.y + resizedSeparatorBox!.height / 2, { steps: 4 });
  await host.mouse.up();
  await panel.waitFor({ state: "hidden", timeout: 5_000 });
  await host.getByTestId("meeting-panel-toggle").click();
  await panel.waitFor({ state: "visible", timeout: 5_000 });
  assert.equal(errors.length, 0, errors.join("\n"));
});
