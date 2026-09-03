const { chromium } = require("playwright");
const WS = "ws://localhost:8080/";
const BASE = "http://localhost:5174/";
const FAKEMEDIA = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"];
(async () => {
  const browser = await chromium.launch({ args: FAKEMEDIA });
  const ctxA = await browser.newContext({ permissions: ["camera", "microphone"] });
  const a = await ctxA.newPage();
  await a.addInitScript(({ WS }) => {
    localStorage.setItem("user_settings", JSON.stringify({ customServerUrl: WS, roomId: "AF", serverMode: "custom" }));
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { uniqId: "wb-A-" + Date.now() } }));
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

  const ctxB = await browser.newContext({ permissions: ["camera", "microphone"] });
  const b = await ctxB.newPage();
  const drawFrames = [];
  b.on("websocket", (ws) => {
    ws.on("framereceived", (f) => { const t = f.payload.toString(); if (/meeting:draw/.test(t)) drawFrames.push(t.slice(0, 160)); });
  });
  await b.addInitScript(({ WS, roomId }) => {
    localStorage.setItem("user_settings", JSON.stringify({ customServerUrl: WS, roomId: "BF", serverMode: "custom" }));
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { uniqId: "wb-B-" + Date.now() } }));
  }, { WS, roomId });
  await b.goto(`${BASE}#/meeting?room=${roomId}`, { waitUntil: "networkidle", timeout: 35000 });
  await b.waitForFunction(() => !!window.__meeting, { timeout: 20000 });
  await b.waitForTimeout(2500);

  // A 开画板画线
  await a.locator('button[aria-label="画板"]').click({ force: true });
  await a.waitForTimeout(400);
  const box = await a.locator("canvas").first().boundingBox();
  console.log("A canvas box:", JSON.stringify(box));
  const sx = box.x + box.width * 0.35, sy = box.y + box.height * 0.5; // 避开左上角工具条
  await a.mouse.move(sx, sy);
  await a.mouse.down();
  for (let i = 1; i <= 10; i++) { await a.mouse.move(sx + i * 25, sy + i * 12); await a.waitForTimeout(40); }
  await a.mouse.up();
  await a.waitForTimeout(800);

  console.log(`B 收到 draw 帧数: ${drawFrames.length}`);
  drawFrames.slice(0, 4).forEach((f) => console.log("  ", f));

  // B 端状态
  const st = await b.evaluate(() => {
    const cvs = [...document.querySelectorAll("canvas")].map((cv) => {
      let ink = -1;
      try {
        const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { ink = i; break; }
      } catch (e) { ink = -2; }
      return { w: cv.width, h: cv.height, ink };
    });
    return { remote: window.__meeting.getState().remoteTracks.length, canvases: cvs };
  });
  console.log("B state:", JSON.stringify(st));
  await b.screenshot({ path: ".e2e-diag-wb-B.png" });
  await a.screenshot({ path: ".e2e-diag-wb-A.png" });
  await browser.close();
})();
