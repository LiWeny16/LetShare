const { chromium } = require("playwright");
const WS = "ws://localhost:8080/";
const BASE = "http://localhost:5174/";
const FAKEMEDIA = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"];
(async () => {
  const browser = await chromium.launch({ args: FAKEMEDIA });
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const a = await ctx.newPage();
  await a.addInitScript(({ WS }) => {
    localStorage.setItem("user_settings", JSON.stringify({ customServerUrl: WS, roomId: "AF", serverMode: "custom" }));
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { uniqId: "dup-A-" + Date.now() } }));
  }, { WS });
  await a.goto(BASE, { waitUntil: "networkidle", timeout: 35000 });
  await a.waitForTimeout(1200);
  await a.locator('button[aria-label="plus"]').click({ force: true });
  await a.waitForTimeout(400);
  await a.locator('[role="menuitem"]').filter({ hasText: "创建会议" }).first().click({ force: true });
  await a.waitForTimeout(600);
  await a.locator('[role="dialog"] button').filter({ hasText: "开始会议" }).first().click({ force: true });
  await a.waitForURL(/room=(\d{4})/, { timeout: 15000 });
  const roomId = (a.url().match(/room=(\d{4})/) || [])[1];
  await a.waitForFunction(() => !!window.__meeting, { timeout: 20000 });
  await a.waitForTimeout(2000);

  // B 用 CDP 层监听原始帧
  const ctx2 = await browser.newContext({ permissions: ["camera", "microphone"] });
  const b = await ctx2.newPage();
  const seen = [];
  b.on("websocket", (ws) => {
    ws.on("framereceived", (f) => { const t = f.payload.toString(); if (/meeting:chat/.test(t)) seen.push("RAW⇐" + t.slice(0, 150)); });
  });
  await b.addInitScript(({ WS, roomId }) => {
    localStorage.setItem("user_settings", JSON.stringify({ customServerUrl: WS, roomId: "BF", serverMode: "custom" }));
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { uniqId: "dup-B-" + Date.now() } }));
  }, { WS, roomId });
  await b.goto(`${BASE}#/meeting?room=${roomId}`, { waitUntil: "networkidle", timeout: 35000 });
  await b.waitForFunction(() => !!window.__meeting, { timeout: 20000 });
  await b.waitForTimeout(2500);

  // A 发两条聊天
  for (const msg of ["dup-test-1", "dup-test-2"]) {
    await a.locator('[placeholder*="发送"]').first().fill(msg);
    await a.keyboard.press("Enter");
    await a.waitForTimeout(1200);
  }
  await b.waitForTimeout(800);
  const ui = await b.evaluate(() => document.body.innerText.match(/dup-test-\d/g) || []);
  console.log("=== CDP 层收到的原始 chat 帧 ===");
  seen.forEach((s) => console.log(s));
  console.log("=== B 页面 UI 中出现的消息 ===", JSON.stringify(ui));
  await browser.close();
})();
