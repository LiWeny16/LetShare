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
}

test("meeting assistant is a private streaming chat contact", async (t) => {
  const browser = await chromium.launch({
    headless: false,
    args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"],
  });
  t.after(async () => { await browser.close(); });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await configurePage(page, "ai-chat-host", "4321");

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource: the server responded with a status of 404/i.test(message.text())) {
      errors.push(message.text());
    }
  });

  console.log("STEP create meeting");
  await page.goto(`${SITE}/?room=4321#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await page.locator('button[aria-label="plus"]:visible').first().click();
  await page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await page.getByTestId("meeting-pass").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: /进入会议|Enter meeting/ }).last().click();
  const nameGate = page.getByTestId("meeting-name-gate");
  if (await nameGate.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await page.getByTestId("meeting-name-input").fill("AI chat host");
    await page.getByRole("button", { name: /进入会议|Enter meeting/ }).last().click();
  }
  await until("host in-meeting", async () => (await page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");

  console.log("STEP open AI minutes and start");
  await page.getByTestId("meeting-ai-minutes-open").click();
  await page.getByTestId("meeting-ai-minutes-workspace").waitFor({ state: "visible" });
  await page.getByTestId("meeting-minutes-start").click();
  await page.getByTestId("meeting-minutes-stop").waitFor({ state: "visible", timeout: 15_000 });

  console.log("STEP jump to private chat with the assistant");
  await page.getByTestId("meeting-ask-assistant").click();
  await page.getByPlaceholder("问会议助手，例如：刚才谁说了什么？").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByText("会议助手", { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });

  console.log("STEP ask the assistant");
  await page.getByPlaceholder("问会议助手，例如：刚才谁说了什么？").fill("刚才谁说了什么？下一步是什么？");
  await page.locator("#meeting-panel-content-chat").getByRole("button", { name: "发送消息" }).click();

  const aiMessage = page.locator('[data-testid="meeting-chat-ai-message"]').last();
  await aiMessage.waitFor({ state: "visible", timeout: 15_000 });
  await until("assistant stream completes", async () => (await aiMessage.getAttribute("data-streaming")) === "false", 45_000);
  const answer = (await aiMessage.innerText()).trim();
  console.log("ASSISTANT ANSWER:", answer);
  assert.ok(answer.length >= 4, "assistant answer should not be empty");
  assert.equal(/会议助手暂时不可用|会议助手暂未配置|请求过于频繁/.test(answer), false, answer);

  if (process.env.E2E_CHAT_SCREENSHOT) await page.screenshot({ path: process.env.E2E_CHAT_SCREENSHOT, fullPage: false });
  await page.getByTestId("meeting-minutes-stop").click().catch(() => undefined);
  assert.equal(errors.length, 0, errors.join("\n"));
});
