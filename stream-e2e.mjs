import { createHash } from "node:crypto";
import { chromium } from "playwright";
const SITE = "http://localhost:5173";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");
const WAV = "C:/Users/onion/AppData/Local/Temp/letshare-speech-zh.wav";
const ROOM = String(4800 + Math.floor(Math.random() * 150));
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`, "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = [];
page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") logs.push("CONSOLE " + m.text().slice(0, 160)); });
await page.addInitScript(({ token, room }) => {
  localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: "stream-host", uniqId: "stream-host:e2e" } }));
  localStorage.setItem("user_settings", JSON.stringify({ roomId: room, userTheme: "light", userLanguage: "zh", serverMode: "custom", customServerUrl: "ws://localhost:8080/", authToken: token, ablyKey: "", transferPriority: "p2p", version: "3.9.9", isNewUser: false, meetingMicrophoneDefaultOn: true }));
}, { token: TOKEN, room: ROOM });
await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30000 });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.locator('button[aria-label="plus"]:visible').first().click();
await page.waitForTimeout(400);
await page.locator('[role="menuitem"]').first().click();
const dialog = page.locator('[role="dialog"]').first();
await dialog.waitFor({ state: "visible", timeout: 15000 });
await dialog.getByRole("button", { name: /进入会议/ }).last().click();
if (await page.getByTestId("meeting-name-gate").waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false)) {
  await page.getByTestId("meeting-name-input").fill("stream host");
  await page.getByRole("button", { name: /进入会议/ }).last().click();
}
await page.waitForFunction(() => document.querySelector('[data-testid="meeting-stage"]')?.getAttribute("data-stage") === "in-meeting", null, { timeout: 30000 });
await page.getByTestId("meeting-live-captions-toolbar").click();
const consent = page.getByTestId("meeting-minutes-consent-dialog");
console.log("consent:", await consent.waitFor({ state: "visible", timeout: 12000 }).then(() => true).catch(() => false));
const t0 = Date.now();
await page.getByTestId("meeting-minutes-consent-accept").click();
let first = null, last = "", lastText = "";
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.querySelector('[data-testid="meeting-live-captions-overlay"]')?.textContent || "");
  if (text !== lastText) {
    lastText = text;
    if (!first && text && !text.includes("等待") && !text.includes("正在使用")) { first = Date.now() - t0; console.log(`first @${first}ms:`, JSON.stringify(text.slice(0, 80))); }
    if (text && /[我我们确认预算决定下一]/.test(text)) last = text;
  }
  if (first && last && Date.now() - t0 > first + 3000) break;
}
console.log("FINAL:", JSON.stringify(last.slice(0, 160)), "first(ms):", first);
console.log("logs:", logs.slice(0, 5));
await page.screenshot({ path: "C:/Users/onion/AppData/Local/Temp/letshare-stream.png" });
await browser.close();
