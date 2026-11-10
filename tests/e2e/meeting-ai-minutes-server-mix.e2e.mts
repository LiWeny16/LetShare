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

async function configurePage(page: Page, userId: string, roomId: string, microphoneOn: boolean): Promise<void> {
  await page.addInitScript(({ token, ws, userId, roomId, microphoneOn }) => {
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
      meetingMicrophoneDefaultOn: microphoneOn,
    }));
  }, { token: TOKEN, ws: WS, userId, roomId, microphoneOn });
}

test("server-mixed minutes uses real Opus -> ASR -> Gemini", async (t) => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      // Auto-accept the microphone permission but keep the real input device.
      "--use-fake-ui-for-media-stream",
    ],
  });
  t.after(async () => { await browser.close(); });

  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostContext.newPage();
  const member = await memberContext.newPage();
  await configurePage(host, "real-host", "4321", true);
  await configurePage(member, "real-member", "4321", false);

  const errors: string[] = [];
  for (const page of [host, member]) {
    page.on("pageerror", (error) => errors.push(`${page === host ? "host" : "member"}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource: the server responded with a status of 404/i.test(message.text())) {
        errors.push(`${page === host ? "host" : "member"}: ${message.text()}`);
      }
    });
  }

  console.log("STEP host: create meeting");
  await host.goto(`${SITE}/?room=4321#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await host.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await host.locator('button[aria-label="plus"]:visible').first().click();
  await host.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.getByTestId("meeting-pass").waitFor({ state: "visible", timeout: 15_000 });
  await host.getByRole("button", { name: /开始会议|Start meeting/ }).last().click();
  await host.getByRole("button", { name: /进入会议|Enter meeting/ }).last().waitFor({ state: "visible", timeout: 15_000 });
  await host.getByRole("button", { name: /进入会议|Enter meeting/ }).last().click();
  const hostNameGate = host.getByTestId("meeting-name-gate");
  if (await hostNameGate.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await host.getByTestId("meeting-name-input").fill("Real host");
    await host.getByRole("button", { name: /进入会议|Enter meeting/ }).last().click();
  }
  await until("host in-meeting", async () => (await host.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");

  const meetingId = await host.evaluate(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("room"));
  assert.match(meetingId ?? "", /^\d{4}$/);
  console.log(`STEP host: meeting ${meetingId}`);

  console.log("STEP member: join");
  await member.goto(`${SITE}/#/meeting?room=${meetingId}&source=4321`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const memberNameGate = member.getByTestId("meeting-name-gate");
  if (await memberNameGate.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await member.getByTestId("meeting-name-input").fill("Real member");
    await member.getByRole("button", { name: /进入会议|Enter meeting/ }).last().click();
  }
  await until("member in-meeting", async () => (await member.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");

  console.log("STEP host: open AI minutes settings");
  await host.getByTestId("meeting-ai-minutes-open").click();
  await host.getByTestId("meeting-ai-minutes-workspace").waitFor({ state: "visible" });
  await host.getByRole("button", { name: "纪要设置" }).click();
  await host.getByRole("radiogroup", { name: "纪要生成语言" }).waitFor({ state: "visible", timeout: 10_000 });
  await host.getByRole("button", { name: "保存", exact: true }).click();
  await host.getByTestId("meeting-ai-minutes-workspace").waitFor({ state: "visible", timeout: 10_000 });

  console.log("STEP host: start minutes");
  await host.getByTestId("meeting-minutes-start").click();

  console.log("STEP participants: recording notice");
  for (const page of [host, member]) {
    const notice = page.getByTestId("meeting-minutes-notice-dialog");
    await notice.waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await notice.getByRole("button").count(), 1, "the recording notice only offers acknowledgement");
  }
  await host.getByTestId("meeting-minutes-notice-acknowledge").click();

  console.log("SPEAK NOW: please speak Chinese into the host microphone for 40-60 seconds");
  await host.evaluate(() => {
    const banner = document.createElement("div");
    banner.textContent = "请现在对着麦克风连续说 40–60 秒中文；概览出现后继续说一段";
    banner.style.cssText = "position:fixed;z-index:99999;left:50%;top:14px;transform:translateX(-50%);background:#1677ff;color:#fff;padding:12px 22px;border-radius:12px;font:700 18px/1.4 sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35)";
    document.body.appendChild(banner);
  });
  await until("first real transcript segment", async () => {
    const text = await host.getByTestId("meeting-minutes-segment-count").innerText();
    const count = Number.parseInt(text, 10);
    return Number.isFinite(count) && count >= 1;
  }, 75_000);
  console.log("STEP host: first transcript segment received");

  // The member notice remains open while the host's first transcript arrives.
  await member.getByTestId("meeting-minutes-notice-acknowledge").click();

  console.log("STEP host: wait for a live summary while recording");
  try {
    await until("live summary while recording", async () => {
      const text = await host.getByTestId("meeting-minutes-overview").innerText();
      return text.trim().length > 8 && !text.includes("会议开始记录后") && !text.includes("重点、决策和行动项会出现在这里");
    }, 60_000);
  } catch (error) {
    console.log("LIVE SUMMARY ALERTS:", JSON.stringify(await host.locator('[role="alert"]').allInnerTexts()));
    console.log("PAGE ERRORS:", errors.join("\n"));
    throw error;
  }
  console.log("STEP host: live summary received");

  console.log("STEP host: keep speaking for one more batch (best effort)");
  await until("second transcript segment", async () => {
    const text = await host.getByTestId("meeting-minutes-segment-count").innerText();
    return Number.parseInt(text, 10) >= 2;
  }, 45_000).catch(() => undefined);

  console.log("STEP host: stop and finalize");
  await host.getByTestId("meeting-minutes-stop").click();
  try {
    await until("final summary", async () => {
      return host.getByText("已生成", { exact: true }).isVisible().catch(() => false);
    }, 60_000);
  } catch (error) {
    console.log("SUMMARY ALERTS:", JSON.stringify(await host.locator('[role="alert"]').allInnerTexts()));
    console.log("PAGE ERRORS:", errors.join("\n"));
    throw error;
  }
  console.log("STEP host: summary received");

  const bodyText = await host.locator("body").innerText();
  assert.match(bodyText, /会议纪要|会议概览|决策|行动项/);
  assert.equal(errors.length, 0, errors.join("\n"));
});
