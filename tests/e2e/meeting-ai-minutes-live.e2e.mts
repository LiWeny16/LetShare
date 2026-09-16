import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

async function until(desc: string, condition: () => Promise<boolean>, timeoutMs = 45_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting for ${desc}`);
}

async function configurePage(page: Page, userId: string, roomId: string): Promise<void> {
  await page.addInitScript(({ token, ws, userId, roomId }) => {
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId, uniqId: `${userId}:e2e` } }));
    localStorage.setItem("user_settings", JSON.stringify({ roomId, userTheme: "light", userLanguage: "zh", serverMode: "custom", customServerUrl: ws, authToken: token, ablyKey: "", transferPriority: "p2p", version: "3.8.4", isNewUser: false, meetingCameraDefaultOn: false, meetingMicrophoneDefaultOn: false }));
  }, { token: TOKEN, ws: WS, userId, roomId });
  const fakeUserId = JSON.stringify(userId);
  await page.addInitScript({ content: `(() => {
    function FakeSpeech() { this.onresult = null; this.onend = null; this.stopped = false; }
    FakeSpeech.prototype.start = function () { var self = this; window.setTimeout(function () { if (self.stopped) return; if (self.onresult) self.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "模拟最终转写 from " + ${fakeUserId} }, length: 1 }] }); }, 160); };
    FakeSpeech.prototype.stop = function () { this.stopped = true; if (this.onend) this.onend(); };
    FakeSpeech.prototype.abort = function () { this.stopped = true; };
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, writable: true, value: FakeSpeech });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, writable: true, value: FakeSpeech });
  })();` });
}

test("host finalizes simulated participant ASR with MiMo and saves local history", { timeout: 180_000 }, async (t) => {
  const apiKey = process.env.MIMO_TEST_KEY?.trim();
  if (!apiKey) {
    t.skip("set MIMO_TEST_KEY to run the live meeting flow");
    return;
  }
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  t.after(async () => { await browser.close(); });
  const host = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const member = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await configurePage(host, "live-ai-host", "4321");
  await configurePage(member, "live-ai-member", "4321");

  await host.goto(`${SITE}/?room=4321#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await host.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await host.locator('button[aria-label="plus"]:visible').first().click();
  await host.locator('[role="menuitem"]').first().click();
  await host.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await host.getByRole("button", { name: /开始会议|进入会议|Start meeting|Join meeting/ }).click();
  const hostNameGate = host.getByTestId("meeting-name-gate");
  if (await hostNameGate.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) { await host.getByTestId("meeting-name-input").fill("live AI host"); await host.getByRole("button", { name: /进入会议|Enter meeting/ }).last().click(); }
  await until("host in meeting", async () => (await host.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");
  const meetingId = await host.evaluate(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("room"));
  assert.match(meetingId ?? "", /^\d{4}$/);

  await member.goto(`${SITE}/#/meeting?room=${meetingId}&source=4321`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const memberNameGate = member.getByTestId("meeting-name-gate");
  if (await memberNameGate.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) { await member.getByTestId("meeting-name-input").fill("live AI member"); await member.getByRole("button", { name: /进入会议|Enter meeting/ }).last().click(); }
  await until("member in meeting", async () => (await member.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");

  await host.getByTestId("meeting-ai-minutes-open").click();
  const workspace = host.getByTestId("meeting-ai-minutes-workspace");
  await workspace.waitFor({ state: "visible" });
  await workspace.locator('button:has(svg[data-testid="SettingsOutlinedIcon"])').click();
  await host.getByTestId("meeting-minutes-api-key").fill(apiKey);
  await host.getByTestId("meeting-ai-minutes-panel").getByRole("button").last().click();
  await host.getByTestId("meeting-minutes-start").click();
  await member.getByTestId("meeting-minutes-consent-dialog").waitFor({ state: "visible", timeout: 15_000 });
  await member.getByTestId("meeting-minutes-consent-accept").click();
  await until("host receives simulated final participant segments", async () => (await host.getByTestId("meeting-minutes-segment-count").innerText()).trim() === "2", 30_000);

  await host.getByRole("button", { name: /结束会议/ }).first().click();
  await host.getByRole("button", { name: /结束会议/ }).last().click();
  await host.getByTestId("meeting-ended-summary").waitFor({ state: "visible", timeout: 90_000 });
  await host.getByText("已保存到本机").waitFor({ state: "visible" });
  assert.ok((await host.getByTestId("meeting-ended-summary").innerText()).includes("模拟最终转写"));

  await host.getByTestId("meeting-ended-return").click();
  await host.getByRole("button", { name: "plus" }).click();
  await host.locator('[role="menuitem"]').last().click();
  await host.getByTestId("meeting-minutes-history-dialog").waitFor({ state: "visible" });
  await host.getByText("产品方案评审会").waitFor({ state: "visible" }).catch(() => undefined);
  assert.ok((await host.getByTestId("meeting-minutes-history-dialog").innerText()).includes("live AI") || (await host.getByTestId("meeting-minutes-history-dialog").innerText()).includes("未命名会议"));
});
