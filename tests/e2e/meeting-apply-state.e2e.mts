import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const ROOM = `e2eA${Date.now().toString(36).slice(-5)}`;
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

async function until(description: string, condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
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
  throw new Error(`timeout waiting for ${description}${lastError ? `: ${String(lastError)}` : ""}`);
}

test("meeting application state: reject notifies applicant, approve enters directly", async (t) => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => browser.close());

  async function newClient(name: string) {
    const context = await browser.newContext({ permissions: ["camera", "microphone"] });
    await context.addInitScript(({ name: userName, room, ws, token }) => {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: {
        userId: userName,
        userName,
        userNameExplicit: true,
        uniqId: `${userName}:apply-e2e`,
      } }));
      localStorage.setItem("user_settings", JSON.stringify({
        roomId: room,
        userTheme: "light",
        userLanguage: "zh-CN",
        serverMode: "custom",
        customServerUrl: ws,
        authToken: token,
        ablyKey: "",
        transferPriority: "p2p",
        version: "0",
        isNewUser: false,
      }));
    }, { name, room: ROOM, ws: WS, token: TOKEN });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`[${name}] pageerror: ${error.message.slice(0, 240)}`));
    await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
    return { context, page };
  }

  const host = await newClient("apply-host");
  const applicant = await newClient("apply-applicant");
  t.after(async () => Promise.allSettled([host.context.close(), applicant.context.close()]));

  await until("host sees applicant in the original room", async () =>
    (await host.page.locator('[data-testid="connected-user"]').count()) >= 1, 45_000);

  await host.page.locator('button[aria-label="plus"]:visible').first().click();
  await host.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/ }).click();
  await until("host enters meeting route", async () => (await host.page.evaluate(() => location.hash)).includes("/meeting"), 25_000);
  const hostNameGate = host.page.getByTestId("meeting-name-gate");
  if (await hostNameGate.count()) {
    await host.page.getByTestId("meeting-name-input").fill("apply-host");
    await host.page.getByRole("button", { name: /进入会议|Enter meeting/ }).click();
  }
  await until("applicant sees one meeting action", async () =>
    (await applicant.page.locator('[data-testid="apply-meeting-button"]').count()) === 1, 45_000);
  assert.equal(await applicant.page.locator('[data-testid="meeting-badge"]').count(), 0);

  await applicant.page.locator('[data-testid="apply-meeting-button"]').click();
  await until("host sees one pending application", async () =>
    (await host.page.locator('[data-testid^="meeting-applicant-reject-"]').count()) === 1, 20_000);
  const rejectButton = host.page.locator('[data-testid^="meeting-applicant-reject-"]').first();
  await rejectButton.click();
  await until("applicant receives rejection toast", async () =>
    (await applicant.page.locator("body").innerText()).includes("主持人已拒绝你的入会申请"), 15_000);
  await until("host removes rejected application", async () =>
    (await host.page.locator('[data-testid^="meeting-applicant-reject-"]').count()) === 0, 10_000);

  await applicant.page.locator('[data-testid="apply-meeting-button"]').click();
  await until("host sees the second application", async () =>
    (await host.page.locator('[data-testid^="meeting-applicant-accept-"]').count()) === 1, 20_000);
  await host.page.locator('[data-testid^="meeting-applicant-accept-"]').click();
  await until("applicant is routed to the meeting", async () =>
    (await applicant.page.evaluate(() => window.location.hash)).includes("#/meeting?room="), 20_000);
  await until("host removes approved application", async () =>
    (await host.page.locator('[data-testid^="meeting-applicant-accept-"]').count()) === 0, 10_000);

  await until("applicant joins the meeting", async () =>
    (await applicant.page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 25_000);
  assert.equal(await applicant.page.locator('[data-testid="meeting-invite-dialog"]').count(), 0, "approval must not open a second invite");
  for (const testId of ["meeting-stage-focus", "meeting-stage-fullscreen", "meeting-stage-fullscreen-chat"]) {
    assert.equal(await applicant.page.getByTestId(testId).count(), 1, `${testId} should have one visible control`);
  }
  assert.equal(await applicant.page.getByTestId("meeting-sharing-fullscreen").count(), 0, "sharing surface must not add a duplicate fullscreen control");
});
