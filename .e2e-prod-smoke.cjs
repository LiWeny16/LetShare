/**
 * .e2e-prod-smoke.cjs — 线上冒烟：https://letshare.fun + wss://ecs.letshare.fun
 * 复刻用户报错场景：创建会议（此前"创建会议超时"）→ 邀请链接加入 → 聊天 → 404 → 结束。
 */
const { chromium } = require("playwright");
const BASE = "https://letshare.fun/";
const WS = "wss://ecs.letshare.fun/";
const FAKEMEDIA = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];

const log = [];
const ok = (name, pass, detail = "") => {
  log.push(`${pass ? "PASS" : "FAIL"} [${name}]${detail ? " " + detail : ""}`);
  return pass;
};

async function init(page, { uniqId, roomId }) {
  await page.addInitScript(({ WS, uniqId, roomId }) => {
    localStorage.setItem("user_settings", JSON.stringify({ customServerUrl: WS, roomId, serverMode: "custom" }));
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { uniqId } }));
  }, { WS, uniqId, roomId });
}

async function main() {
  const browser = await chromium.launch({ args: FAKEMEDIA });
  try {
    // A 创建会议
    const ctxA = await browser.newContext({ permissions: ["camera", "microphone"] });
    const a = await ctxA.newPage();
    await init(a, { uniqId: "prod-A-" + Date.now(), roomId: "prodA" });
    await a.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await a.waitForTimeout(2500);
    const save = a.locator('button').filter({ hasText: /SAVE SETTINGS|Save/i }).first();
    if (await save.count()) await save.click({ force: true }).catch(() => { });
    await a.waitForTimeout(800);

    await a.locator('button[aria-label="plus"]').click({ force: true });
    await a.waitForTimeout(500);
    await a.locator('[role="menuitem"]').filter({ hasText: "创建会议" }).first().click({ force: true });
    await a.waitForTimeout(700);
    const dialog = a.locator('[role="dialog"]');
    const t = dialog.locator("input");
    if (await t.count()) await t.first().fill("线上冒烟会");
    await dialog.locator('button').filter({ hasText: "开始会议" }).first().click({ force: true });
    await a.waitForURL(/\/meeting\?room=\d{4}/, { timeout: 20000 }).catch(() => { });
    const roomId = ((a.url().match(/room=(\d{4})/) || [])[1]) || "";
    ok("A-create-prod", !!roomId, `url=${a.url()}`);
    // 等待 MeetingRoom lazy chunk 加载完成（线上 CDN 首载慢，waitForURL 只反映 hash 变化）
    await a.locator("text=邀请他人加入会议").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => { });
    await a.waitForTimeout(500);
    const bodyA = await a.locator("body").innerText().catch(() => "");
    ok("A-sharePanel-prod", /邀请他人加入会议/.test(bodyA) && /复制会议号/.test(bodyA));
    ok("A-stage-inmeeting", !/创建会议超时|不支持的消息类型/.test(bodyA));
    await a.screenshot({ path: ".prod-smoke-A.png" });

    // B 邀请链接加入（真实线上链接）
    const ctxB = await browser.newContext({ permissions: ["camera", "microphone"] });
    const b = await ctxB.newPage();
    await init(b, { uniqId: "prod-B-" + Date.now(), roomId: "prodB" });
    await b.goto(`${BASE}#/meeting?room=${roomId}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await b.waitForTimeout(4000);
    const bodyB = await b.locator("body").innerText().catch(() => "");
    ok("B-join-prod", /离开/.test(bodyB));
    await b.screenshot({ path: ".prod-smoke-B.png" });

    // 成员同步
    await a.waitForTimeout(1500);
    ok("member-sync-prod", /👥 2/.test(await a.locator("body").innerText().catch(() => "")));

    // 聊天
    const chatInput = a.locator('[placeholder*="发送"]');
    if (await chatInput.count()) {
      await chatInput.first().fill("prod-chat-hello");
      await a.keyboard.press("Enter");
      await b.waitForTimeout(1500);
      ok("B-chat-prod", /prod-chat-hello/.test(await b.locator("body").innerText().catch(() => "")));
    } else {
      ok("B-chat-prod", false, "chat input not found");
    }

    // C: 404 负例
    const ctxC = await browser.newContext({ permissions: ["camera", "microphone"] });
    const c = await ctxC.newPage();
    await init(c, { uniqId: "prod-C-" + Date.now(), roomId: "prodC" });
    await c.goto(`${BASE}#/meeting?room=7777`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await c.waitForTimeout(3500);
    ok("C-404-prod", await c.locator("text=会议不存在").first().isVisible().catch(() => false));
    await c.screenshot({ path: ".prod-smoke-C.png" });
    await ctxC.close();

    // A 结束会议
    const endBtn = a.locator("button").filter({ hasText: "结束会议" }).first();
    if (await endBtn.count()) {
      await endBtn.click({ force: true });
      await a.waitForTimeout(500);
      await a.locator('[role="dialog"] button').filter({ hasText: "结束会议" }).last().click({ force: true });
      await a.waitForTimeout(1500);
      await b.waitForTimeout(2500);
      const bUrl = b.url();
      ok("B-ended-prod", !/\/meeting/.test(bUrl) || /会议已结束/.test(await b.locator("body").innerText().catch(() => "")), `url=${bUrl}`);
    } else {
      ok("B-ended-prod", false, "end button not found");
    }
  } finally {
    console.log(log.join("\n"));
    const fails = log.filter((l) => l.startsWith("FAIL")).length;
    console.log(`\n${log.length - fails}/${log.length} passed`);
    await browser.close();
    process.exitCode = fails > 0 ? 1 : 0;
  }
}
main();
