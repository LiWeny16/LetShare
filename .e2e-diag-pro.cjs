/**
 * .e2e-diag-pro.cjs — 诊断会议广播/媒体路径：捕获 WS 帧 + manager 内部状态。
 */
const { chromium } = require("playwright");
const WS = "ws://localhost:8080/";
const BASE = "http://localhost:5174/";
const FAKEMEDIA = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--auto-select-desktop-capture-source=Entire screen",
];

async function init(page, { uniqId, roomId }) {
  await page.addInitScript(({ WS, uniqId, roomId }) => {
    localStorage.setItem("user_settings", JSON.stringify({ customServerUrl: WS, roomId, serverMode: "custom" }));
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { uniqId } }));
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) {
      try { window.__outFrames.push(String(d).slice(0, 180)); } catch { }
      return origSend.call(this, d);
    };
  }, { WS, uniqId, roomId });
}

async function attach(page, tag) {
  await page.addInitScript(() => {
    window.__inFrames = [];
    window.__outFrames = [];
  });
  page.on("console", (m) => {
    const t = m.text();
    if (/meeting|error|失败|超时/i.test(t)) console.log(`[${tag}·console]`, t.slice(0, 200));
  });
}

async function dumpState(page, tag, label) {
  const s = await page.evaluate(() => {
    const m = window.__meeting;
    if (!m) return null;
    const st = m.getState();
    return { room: st.roomId, stage: st.stage, members: st.members.map((x) => x.uniqId), remote: st.remoteTracks.length, hostId: st.hostId, screenOn: st.screenOn };
  }).catch(() => null);
  console.log(`[${tag}] ${label} state=${JSON.stringify(s)}`);
}

async function frames(page, tag, re) {
  const f = await page.evaluate((reSrc) => {
    const r = new RegExp(reSrc);
    return { in: (window.__inFrames || []).filter((x) => r.test(x)), out: (window.__outFrames || []).filter((x) => r.test(x)) };
  }, re.source).catch(() => null);
  console.log(`[${tag}] ${re.source} → out=${JSON.stringify(f?.out || [])} in=${JSON.stringify((f?.in || []).slice(0, 6))}`);
}

async function main() {
  const browser = await chromium.launch({ args: FAKEMEDIA });
  const ctxA = await browser.newContext({ permissions: ["camera", "microphone"] });
  const a = await ctxA.newPage();
  await attach(a, "A");
  await init(a, { uniqId: "diag-A-" + Date.now(), roomId: "A-file-room" });

  // 捕获入站帧：通过 CDP 在页面里挂 onmessage 包装
  await a.addInitScript(() => {
    const orig = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage");
    Object.defineProperty(WebSocket.prototype, "onmessage", {
      set(fn) {
        const wrapped = (ev) => {
          try { window.__inFrames.push(String(ev.data).slice(0, 200)); } catch { }
          return fn.call(this, ev);
        };
        orig.set.call(this, wrapped);
      },
      get() { return orig.get.call(this); },
    });
  });

  await a.goto(BASE, { waitUntil: "networkidle", timeout: 35000 });
  await a.waitForTimeout(1500);
  await a.locator('button[aria-label="plus"]').click({ force: true });
  await a.waitForTimeout(400);
  await a.locator('[role="menuitem"]').filter({ hasText: "创建会议" }).first().click({ force: true });
  await a.waitForTimeout(600);
  const dialog = a.locator('[role="dialog"]');
  await dialog.locator('button').filter({ hasText: "开始会议" }).first().click({ force: true });
  await a.waitForURL(/\/meeting\?room=\d{4}/, { timeout: 15000 }).catch(() => { });
  const roomId = (a.url().match(/room=(\d{4})/) || [])[1] || "";
  console.log(`[A] created roomId=${roomId}`);
  // 等 meeting 页 chunk 完全加载
  await a.waitForFunction(() => !!window.__meeting, { timeout: 20000 }).catch(() => console.log("[A] __meeting hook NOT found"));
  await a.waitForTimeout(2500);
  await dumpState(a, "A", "after-create+join");

  const ctxB = await browser.newContext({ permissions: ["camera", "microphone"] });
  const b = await ctxB.newPage();
  await attach(b, "B");
  await b.addInitScript(() => {
    const orig = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage");
    Object.defineProperty(WebSocket.prototype, "onmessage", {
      set(fn) {
        const wrapped = (ev) => {
          try { window.__inFrames.push(String(ev.data).slice(0, 200)); } catch { }
          return fn.call(this, ev);
        };
        orig.set.call(this, wrapped);
      },
      get() { return orig.get.call(this); },
    });
  });
  await init(b, { uniqId: "diag-B-" + Date.now(), roomId: "B-file-room" });
  await b.goto(`${BASE}#/meeting?room=${roomId}`, { waitUntil: "networkidle", timeout: 35000 });
  await b.waitForFunction(() => !!window.__meeting, { timeout: 20000 }).catch(() => console.log("[B] __meeting hook NOT found"));
  await b.waitForTimeout(3000);
  await dumpState(b, "B", "after-join");
  await dumpState(a, "A", "after-B-joined");

  // A 发聊天 → B 收
  await a.locator('[placeholder*="发送"]').first().fill("diag-chat-1");
  await a.keyboard.press("Enter");
  await a.waitForTimeout(1500);
  await frames(a, "A", /meeting:chat/);
  await frames(b, "B", /meeting:chat|meeting:draw/);
  await dumpState(b, "B", "after-chat");

  // A 开画板画一笔 → B 收 draw
  await a.locator('button[aria-label="画板"]').click({ force: true });
  await a.waitForTimeout(400);
  const box = await a.locator("canvas").first().boundingBox();
  if (box) {
    await a.mouse.move(box.x + 20, box.y + 20);
    await a.mouse.down();
    for (let i = 1; i <= 6; i++) { await a.mouse.move(box.x + 20 + i * 30, box.y + 20 + i * 15); await a.waitForTimeout(30); }
    await a.mouse.up();
  }
  await a.waitForTimeout(1000);
  await frames(a, "A", /meeting:draw/);
  await frames(b, "B", /meeting:draw/);

  // A 屏幕共享 → B 远端轨
  await a.locator('button[aria-label="共享屏幕"]').click({ force: true });
  await a.waitForTimeout(3000);
  await frames(a, "A", /meeting:sdp|meeting:ice/);
  await frames(b, "B", /meeting:sdp|meeting:ice/);
  await dumpState(b, "B", "after-A-share");
  await dumpState(a, "A", "after-A-share");

  await browser.close();
}
main().catch((e) => { console.error("DIAG-ERR", e); process.exit(1); });
