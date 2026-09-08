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
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
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
      if (message.type() === "error") errors.push(`${page === host ? "host" : "member"}: ${message.text()}`);
    });
  }

  await host.goto(`${SITE}/?room=4321#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await host.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await host.locator('button[aria-label="plus"]:visible').first().click();
  await host.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await host.getByRole("button", { name: /开始会议|进入会议|Start meeting|Join meeting/ }).click();
  await until("host in-meeting", async () => (await host.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");

  const meetingId = await host.evaluate(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("room"));
  assert.match(meetingId ?? "", /^\d{4}$/);

  await member.goto(`${SITE}/#/meeting?room=${meetingId}&source=4321`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await until("member in-meeting", async () => (await member.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");

  await host.getByTestId("meeting-ai-minutes-open").click();
  await host.getByTestId("meeting-ai-minutes-dialog").waitFor({ state: "visible" });
  const minuteSwitches = host.locator('[role="dialog"]:visible input[type="checkbox"]');
  await minuteSwitches.first().click();
  await host.getByTestId("meeting-minutes-start").click();

  await until("member receives running minutes state", async () => Boolean(await member.evaluate(() => {
    const state = (window as unknown as { __meeting?: { getState: () => { minutes?: { running?: boolean } } } }).__meeting?.getState();
    return state?.minutes?.running;
  })), 15_000);
  await member.getByTestId("meeting-minutes-consent-dialog").waitFor({ state: "visible", timeout: 15_000 });
  await member.getByTestId("meeting-minutes-consent-accept").click();

  await until("host receives both final transcript segments", async () => {
    const text = await host.getByTestId("meeting-minutes-segment-count").innerText();
    return /^.*2 条最终片段/.test(text);
  }, 20_000);
  const memberState = await member.evaluate(() => (window as unknown as { __meeting?: { getState: () => { minutes: { consented: boolean } } } }).__meeting?.getState());
  assert.equal(memberState?.minutes.consented, true);

  await host.getByTestId("meeting-minutes-stop").click();
  await until("member consent prompt closes after stop", async () => !(await member.getByTestId("meeting-minutes-consent-dialog").isVisible().catch(() => false)));
  assert.equal(errors.length, 0, errors.join("\n"));
});
