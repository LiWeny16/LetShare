import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const ROOM = `late${Date.now().toString(36).slice(-6)}`.slice(0, 12);
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

async function until(description: string, condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await condition()) return;
    } catch {
      // The route can briefly unmount while the app reconnects.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting for ${description}`);
}

test("late ordinary-room join receives active meeting state from membership snapshot", async (t) => {
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  t.after(async () => browser.close());

  async function openClient(name: string) {
    const context = await browser.newContext({ permissions: ["camera", "microphone"] });
    await context.addInitScript(({ name: userName, room, ws, token }) => {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: {
        userId: userName,
        userName,
        userNameExplicit: true,
        uniqId: `${userName}:late-presence`,
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
        meetingCameraDefaultOn: false,
        meetingMicrophoneDefaultOn: false,
      }));
    }, { name, room: ROOM, ws: WS, token: TOKEN });
    const page = await context.newPage();
    await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
    return { context, page };
  }

  const host = await openClient("late-host");
  t.after(async () => host.context.close());

  await host.page.locator('button[aria-label="plus"]:visible').first().click();
  await host.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/ }).click();
  await until("host enters meeting", async () => (await host.page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 45_000);

  const late = await openClient("late-joiner");
  t.after(async () => late.context.close());
  await until("late joiner sees the meeting action from the membership snapshot", async () =>
    (await late.page.locator('[data-testid="apply-meeting-button"]').count()) === 1, 45_000);
  assert.equal(await late.page.locator('[data-testid="meeting-badge"]').count(), 0);
});
