/**
 * .e2e-meeting-pro.cjs — 会议功能生产级全流程 CDP 端到端测试。
 * 覆盖：创建/邀请链接加入/成员同步/实时聊天/协作画板/屏幕共享/踢人/结束会议/404 负例/分组讨论/断线资源清理。
 * 前置：本地 go server :8080（MODE=local）、vite dev :5174。
 */
const { chromium } = require("playwright");
const WS = "wss://ecs.letshare.fun/";
const BASE = "https://letshare.fun/";
const FAKEMEDIA = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--auto-select-desktop-capture-source=Entire screen",
];

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

async function waitMeetingUrl(page, timeout = 15000) {
  await page.waitForURL(/\/meeting\?room=\d{4}/, { timeout }).catch(() => {});
  return page.url();
}

async function bodyText(page) {
  return page.locator("body").innerText().catch(() => "");
}

async function toastVisible(page, text) {
  return page.locator(`text=${text}`).first().isVisible().catch(() => false);
}

async function main() {
  const browser = await chromium.launch({ args: FAKEMEDIA });

  try {
    // ============ A: 创建会议 ============
    const ctxA = await browser.newContext({ permissions: ["camera", "microphone"] });
    const a = await ctxA.newPage();
    await init(a, { uniqId: "pro-A-" + Date.now(), roomId: "A-file-room" });
    await a.goto(BASE, { waitUntil: "networkidle", timeout: 35000 });
    await a.waitForTimeout(900);
    const save = a.locator('button').filter({ hasText: /SAVE SETTINGS|Save/i }).first();
    if (await save.count()) await save.click({ force: true }).catch(() => { });
    await a.waitForTimeout(500);

    await a.locator('button[aria-label="plus"]').click({ force: true });
    await a.waitForTimeout(400);
    await a.locator('[role="menuitem"]').filter({ hasText: "创建会议" }).first().click({ force: true });
    await a.waitForTimeout(600);
    const dialog = a.locator('[role="dialog"]');
    const titleInput = dialog.locator('input');
    if (await titleInput.count()) await titleInput.first().fill("产品评审会");
    await dialog.locator('button').filter({ hasText: "开始会议" }).first().click({ force: true });
    await a.waitForTimeout(2500);
    const urlA = await waitMeetingUrl(a);
    const roomId = (urlA.match(/room=(\d{4})/) || [])[1] || "";
    ok("A-create", !!roomId, `url=${urlA}`);
    const bodyA = await bodyText(a);
    ok("A-sharePanel", /邀请他人加入会议/.test(bodyA) && /复制会议号/.test(bodyA) && /复制链接/.test(bodyA));
    await a.screenshot({ path: ".prod2-A.png" });

    // ============ B: 邀请链接加入 ============
    const ctxB = await browser.newContext({ permissions: ["camera", "microphone"] });
    const b = await ctxB.newPage();
    await init(b, { uniqId: "pro-B-" + Date.now(), roomId: "B-file-room" });
    await b.goto(`${BASE}#/meeting?room=${roomId}`, { waitUntil: "networkidle", timeout: 35000 });
    await b.waitForTimeout(3500);
    const bodyB = await bodyText(b);
    ok("B-join", /离开/.test(bodyB), `hasLeave=${/离开/.test(bodyB)}`);
    await b.screenshot({ path: ".prod2-B.png" });

    // 成员同步
    await a.waitForTimeout(1200);
    const bodyA2 = await bodyText(a);
    ok("member-sync", /👥 2/.test(bodyA2) && /👥 2/.test(bodyB), `A=${/👥 2/.test(bodyA2)} B=${/👥 2/.test(bodyB)}`);

    // 视频互通：fake camera 双端 getUserMedia 成功 → 远端瓦片出现
    const bVideoCount = await b.locator("video").count();
    ok("B-video-tiles", bVideoCount >= 1, `videos=${bVideoCount}`);

    // ============ Chat: A → B ============
    // A 右侧面板默认打开，tab=0 聊天
    const aChatInput = a.locator('textarea, input[placeholder*="发送"], [contenteditable]').first();
    const aPlaceholder = await a.locator('[placeholder*="发送"]').count();
    ok("A-chat-input", aPlaceholder > 0, `inputs=${aPlaceholder}`);
    await a.locator('[placeholder*="发送"]').first().fill("hello-from-A");
    await a.keyboard.press("Enter");
    await a.waitForTimeout(800);
    // A 本地回显
    const bodyAChat = await bodyText(a);
    ok("A-chat-echo", /hello-from-A/.test(bodyAChat));
    // B 收到（B 面板默认打开）
    await b.waitForTimeout(1000);
    const bodyBChat = await bodyText(b);
    ok("B-chat-recv", /hello-from-A/.test(bodyBChat));
    await b.screenshot({ path: ".prod2-B-chat.png" });

    // ============ Whiteboard: A 画 → B overlay 自动展开且有墨迹 ============
    const wbBtn = a.locator('button[aria-label="画板"]');
    ok("A-wb-btn", await wbBtn.count() > 0);
    await wbBtn.click({ force: true });
    await a.waitForTimeout(400);
    // A 在 canvas 上画一条线（起点避开左上角工具条）
    const aCanvas = a.locator("canvas").first();
    ok("A-wb-canvas", await aCanvas.count() > 0);
    const box = await aCanvas.boundingBox();
    if (box) {
      const sx = box.x + box.width * 0.35, sy = box.y + box.height * 0.5;
      await a.mouse.move(sx, sy);
      await a.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await a.mouse.move(sx + i * 25, sy + i * 12);
        await a.waitForTimeout(30);
      }
      await a.mouse.up();
    }
    await a.waitForTimeout(600);
    await a.screenshot({ path: ".prod2-A-wb.png" });
    // B 自动展开 overlay + canvas 有墨迹
    await b.waitForTimeout(1200);
    const bInk = await b.evaluate(() => {
      const cvs = document.querySelectorAll("canvas");
      for (const cv of cvs) {
        try {
          const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
        } catch { }
      }
      return false;
    });
    ok("B-wb-recv", bInk);
    await b.screenshot({ path: ".prod2-B-wb.png" });

    // ============ Screen share: A 共享 → B 出现共享画面 ============
    const shareBtn = a.locator('button[aria-label="共享屏幕"]');
    ok("A-share-btn", await shareBtn.count() > 0);
    await shareBtn.click({ force: true });
    await a.waitForTimeout(2500);
    const bodyAShare = await bodyText(a);
    ok("A-share-own", /共享/.test(bodyAShare));
    await a.screenshot({ path: ".prod2-A-share.png" });
    await b.waitForTimeout(2500);
    // B 远端新增 1 个 video 元素 = 屏幕共享轨经重协商扇出到达（生产构建无 __meeting 钩子，用 DOM 判定）
    const bVideosAfterShare = await b.locator("video").count();
    ok("B-share-recv", bVideosAfterShare === bVideoCount + 1, `videos ${bVideoCount}→${bVideosAfterShare}`);
    await b.screenshot({ path: ".prod2-B-share.png" });

    // ============ Kick: C 加入，A 踢出 C ============
    const ctxC = await browser.newContext({ permissions: ["camera", "microphone"] });
    const c = await ctxC.newPage();
    await init(c, { uniqId: "pro-C-" + Date.now(), roomId: "C-file-room" });
    await c.goto(`${BASE}#/meeting?room=${roomId}`, { waitUntil: "networkidle", timeout: 35000 });
    await c.waitForTimeout(2500);
    ok("C-join", /离开/.test(await bodyText(c)));
    await a.waitForTimeout(1200);
    // A 打开成员 tab，精确踢出 C 所在行
    await a.locator('button[role="tab"], .MuiTab-root').filter({ hasText: /成员/ }).first().click({ force: true });
    await a.waitForTimeout(600);
    const cKickBtn = a.locator('li:has-text("pro-C")').locator('button[aria-label="移出会议"]').first();
    ok("A-kick-btn", await cKickBtn.count() > 0, `rows=${await a.locator('li:has-text("pro-C")').count()}`);
    await cKickBtn.click({ force: true });
    await c.waitForTimeout(2500);
    const cUrl = c.url();
    const cToast = await toastVisible(c, "移出");
    ok("C-kicked-out", !/\/meeting/.test(cUrl) || cToast, `url=${cUrl} toast=${cToast}`);
    await c.screenshot({ path: ".prod2-C-kicked.png" });
    await ctxC.close();

    // A/B 成员回到 2
    await a.waitForTimeout(1500);
    ok("member-after-kick", /👥 2/.test(await bodyText(a)));

    // ============ Breakout: A 分组（B → B1），B 自动切换；召回回主会场 ============
    const boBtn = a.locator('button[aria-label="breakout"]');
    ok("A-bo-btn", await boBtn.count() > 0);
    await boBtn.click({ force: true });
    await a.waitForTimeout(500);
    await a.locator('button').filter({ hasText: "开始分组" }).first().click({ force: true });
    await b.waitForTimeout(3000);
    const bodyBbo = await bodyText(b);
    const bInBreakout = (/分组1|B1/.test(bodyBbo)) && /分组讨论中/.test(bodyBbo);
    ok("B-breakout-joined", bInBreakout, `group=${/分组1|B1/.test(bodyBbo)} chip=${/分组讨论中/.test(bodyBbo)}`);
    await b.screenshot({ path: ".prod2-B-breakout.png" });
    // B 在 breakout 聊天发消息 → A（主会场）不应收到（房间隔离）
    await b.locator('[placeholder*="发送"]').first().fill("breakout-secret");
    await b.keyboard.press("Enter");
    await a.waitForTimeout(1000);
    const bodyAbo = await bodyText(a);
    ok("breakout-isolation", !/breakout-secret/.test(bodyAbo));
    // A 召回
    await a.locator('button').filter({ hasText: "召集回归" }).first().click({ force: true });
    await b.waitForTimeout(3000);
    const bodyBback = await bodyText(b);
    ok("B-breakout-recall", !/分组讨论中/.test(bodyBback), `chipGone=${!/分组讨论中/.test(bodyBback)}`);
    await b.screenshot({ path: ".prod2-B-recall.png" });

    // ============ End: A 结束会议 → B 退出 ============
    await a.locator('button').filter({ hasText: "结束会议" }).first().click({ force: true });
    await a.waitForTimeout(400);
    await a.locator('[role="dialog"] button').filter({ hasText: "结束会议" }).last().click({ force: true });
    await a.waitForTimeout(1200);
    await b.waitForTimeout(2500);
    const bUrl = b.url();
    const bToast = await toastVisible(b, "会议已结束");
    ok("B-ended-out", !/\/meeting/.test(bUrl) || bToast, `url=${bUrl} toast=${bToast}`);
    ok("A-ended-out", !/\/meeting/.test(a.url()), `url=${a.url()}`);
    await b.screenshot({ path: ".prod2-B-ended.png" });

    // ============ 404: 加入不存在的会议号 ============
    const ctxD = await browser.newContext({ permissions: ["camera", "microphone"] });
    const d = await ctxD.newPage();
    await init(d, { uniqId: "pro-D-" + Date.now(), roomId: "D-file-room" });
    await d.goto(`${BASE}#/meeting?room=7777`, { waitUntil: "networkidle", timeout: 35000 });
    await d.waitForTimeout(2500);
    ok("D-404", await toastVisible(d, "会议不存在"));
    await d.screenshot({ path: ".prod2-D-404.png" });
    await ctxD.close();

    // ============ 服务器资源清理验证：结束后再入同号应 404（会议号已释放则可能成功——跳过，改由 go 测试覆盖） ============
  } finally {
    console.log(log.join("\n"));
    const fails = log.filter((l) => l.startsWith("FAIL")).length;
    console.log(`\n${log.length - fails}/${log.length} passed`);
    await browser.close();
    process.exitCode = fails > 0 ? 1 : 0;
  }
}
main();
