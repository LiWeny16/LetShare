const { chromium } = require("playwright");
const WS = "ws://localhost:8080/";
const BASE = "http://localhost:5174/";

async function init(page, { uniqId, roomId }) {
  await page.addInitScript(({ WS, uniqId, roomId }) => {
    localStorage.setItem("user_settings", JSON.stringify({ customServerUrl: WS, roomId, serverMode: "custom" }));
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { uniqId } }));
  }, { WS, uniqId, roomId });
}

async function waitMeetingUrl(page, timeout = 15000) {
  await page.waitForURL(/\/meeting\?room=\d{4}/, { timeout }).catch(() => {});
  return page.url();
}

async function main() {
  const browser = await chromium.launch();
  const log = [];

  // ============ A: 创建会议(带会议名) ============
  const ctxA = await browser.newContext({ permissions: ["camera", "microphone"] });
  const a = await ctxA.newPage();
  await init(a, { uniqId: "e2e-A-" + Date.now(), roomId: "A-file-room" });
  await a.goto(BASE, { waitUntil: "networkidle", timeout: 35000 });
  await a.waitForTimeout(900);
  const save = a.locator('button').filter({ hasText: /SAVE SETTINGS|Save/i }).first();
  if (await save.count()) await save.click({ force: true }).catch(()=>{});
  await a.waitForTimeout(500);

  await a.locator('button[aria-label="plus"]').click({ force: true });
  await a.waitForTimeout(400);
  await a.locator('[role="menuitem"]').filter({ hasText: "创建会议" }).first().click({ force: true });
  await a.waitForTimeout(600);
  // 创建模式 Dialog：输入会议名称（可选）
  const dialog = a.locator('[role="dialog"]');
  const titleText = await dialog.locator('h2').innerText().catch(() => "");
  log.push(`[A] dialogTitle=${JSON.stringify(titleText.trim())}`);
  const titleInput = dialog.locator('input');
  if (await titleInput.count()) await titleInput.first().fill("产品设计评审");
  await a.waitForTimeout(300);
  // 点击“开始会议”
  await dialog.locator('button').filter({ hasText: "开始会议" }).first().click({ force: true });
  await a.waitForTimeout(2500);
  const urlA = await waitMeetingUrl(a);
  const roomId = (urlA.match(/room=(\d{4})/) || [])[1] || "";
  log.push(`[A] created url=${urlA} roomId=${roomId}`);
  const bodyA = await a.locator("body").innerText().catch(() => "");
  const linesA = bodyA.split("\n").filter(Boolean);
  log.push(`[A] top=${JSON.stringify(linesA.slice(0, 6))}`);
  log.push(`[A] hasSharePanel=${/邀请他人加入会议/.test(bodyA)} hasMeetingId=${/复制会议号/.test(bodyA)} hasCopyLink=${/复制链接/.test(bodyA)}`);
  await a.screenshot({ path: ".e2e-flow-A.png", fullPage: false });

  // ============ B: 用分享链接加入 ============
  const ctxB = await browser.newContext({ permissions: ["camera", "microphone"] });
  const b = await ctxB.newPage();
  await init(b, { uniqId: "e2e-B-" + Date.now(), roomId: "B-file-room" });
  await b.goto(`${BASE}#/meeting?room=${roomId}`, { waitUntil: "networkidle", timeout: 35000 });
  await b.waitForTimeout(2500);
  const bodyB = await b.locator("body").innerText().catch(() => "");
  const linesB = bodyB.split("\n").filter(Boolean);
  log.push(`[B] snippet=${JSON.stringify(linesB.slice(0, 6))}`);
  log.push(`[B] hasLeave=${/离开/.test(bodyB)}`);
  await b.screenshot({ path: ".e2e-flow-B.png", fullPage: false });

  // ============ A 应看到成员数 2 ============
  await a.waitForTimeout(1500);
  const bodyA2 = await a.locator("body").innerText().catch(() => "");
  const peopleA2 = bodyA2.split("\n").filter((l) => /👥/.test(l));
  log.push(`[A-afterB] people=${JSON.stringify(peopleA2)}`);

  // ============ C: 加入不存在的会议号(负例) ============
  const ctxC = await browser.newContext({ permissions: ["camera", "microphone"] });
  const c = await ctxC.newPage();
  c.on("websocket", (ws) => {
    ws.on("framereceived", (f) => {
      const t = f.payload.toString().slice(0, 200);
      if (/error|meeting|membership/.test(t)) log.push(`[C⇐] ${t}`);
    });
  });
  await init(c, { uniqId: "e2e-C-" + Date.now(), roomId: "C-file-room" });
  await c.goto(`${BASE}#/meeting?room=7777`, { waitUntil: "networkidle", timeout: 35000 });
  await c.waitForTimeout(2500);
  const notFoundToast = await c.locator('text=会议不存在').first().isVisible().catch(() => false);
  log.push(`[C] errorToastVis=会议不存在:${notFoundToast}`);
  const bodyC = await c.locator("body").innerText().catch(() => "");
  log.push(`[C] bodyHasLeave=${/离开/.test(bodyC)}`);
  await c.screenshot({ path: ".e2e-flow-C.png", fullPage: false });

  console.log(log.join("\n"));
  await browser.close();
}
main();