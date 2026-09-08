/**
 * WF-3.8.3: real two-browser breakout-room flow.
 * The host stays in the main meeting while the assigned member switches to a
 * child meeting, then the host recalls the member. The test also asserts that
 * a non-host does not receive the host-only breakout control.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";

const SITE = "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const SOURCE_ROOM = "e2ebreak1";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

async function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting: ${desc}`);
}

test("host breakout assignment and recall are real isolated UI flows", async (t) => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser.close(); });

  async function newClient(name: string): Promise<Page> {
    const context = await browser.newContext({
      permissions: ["camera", "microphone"],
      viewport: { width: 1280, height: 720 },
    });
    await context.addInitScript((arg: { name: string; sourceRoom: string; ws: string; token: string }) => {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: arg.name, uniqId: `${arg.name}:breakout` } }));
      localStorage.setItem("user_settings", JSON.stringify({
        roomId: arg.sourceRoom,
        userTheme: "light",
        userLanguage: "zh-CN",
        serverMode: "custom",
        customServerUrl: arg.ws,
        authToken: arg.token,
        ablyKey: "",
        transferPriority: "p2p",
        version: "0",
        isNewUser: false,
      }));
    }, { name, sourceRoom: SOURCE_ROOM, ws: WS, token: TOKEN });
    const page = await context.newPage();
    await page.goto(`${SITE}/?room=${SOURCE_ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
    return page;
  }

  const host = await newClient("breakout-host");
  const guest = await newClient("breakout-guest");

  await until("source room presence", async () =>
    (await host.locator('button[aria-label="语音通话"], button[aria-label="Voice call"]').count()) >= 1 &&
    (await guest.locator('button[aria-label="语音通话"], button[aria-label="Voice call"]').count()) >= 1,
    60_000);

  await host.locator('button[aria-label="plus"]:visible').first().click();
  await host.getByRole("menuitem", { name: /创建会议/ }).click();
  await host.getByLabel(/会议名称/).fill("Breakout UX 验证");
  await host.getByRole("button", { name: /开始会议/ }).click();
  await host.getByRole("button", { name: /进入会议/ }).click();
  await until("host in meeting", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.stage)) === "in-meeting");
  const meetingId = String(await host.evaluate(() => (window as any).__meeting?.getState()?.roomId));
  assert.match(meetingId, /^\d{4}$/);

  await guest.evaluate((id: string) => { window.location.hash = `#/meeting?room=${id}`; }, meetingId);
  await until("guest in meeting", async () =>
    (await guest.evaluate(() => (window as any).__meeting?.getState()?.stage)) === "in-meeting");
  assert.equal(await guest.getByRole("button", { name: /分组讨论/ }).count(), 0, "non-host must not see breakout control");

  await host.getByRole("button", { name: /分组讨论/ }).click();
  const dialog = host.getByRole("dialog");
  await dialog.getByRole("button", { name: /开始分组/ }).click();
  await until("guest enters child breakout", async () =>
    (await guest.evaluate(() => (window as any).__meeting?.getState()?.roomId)) === `${meetingId}B1`);
  assert.equal(await host.evaluate(() => (window as any).__meeting?.getState()?.roomId), meetingId, "host remains in main meeting");
  await host.getByRole("button", { name: /召集回归|召回/ }).waitFor({ state: "visible" });

  await host.getByRole("button", { name: /召集回归|召回/ }).click();
  await until("guest returns to main meeting", async () =>
    (await guest.evaluate(() => (window as any).__meeting?.getState()?.roomId)) === meetingId);
  await until("guest remains connected after recall", async () =>
    (await guest.evaluate(() => (window as any).__meeting?.getState()?.stage)) === "in-meeting");

  console.log(`[e2e] breakout child ${meetingId}B1 created, guest switched, host recalled, and guest returned to ${meetingId}`);
});
