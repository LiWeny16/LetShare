/**
 * E2E: Busy guard — 通话中收到会议邀请自动拒绝
 *
 * 场景：
 *   1. alice + bob 在普通房间
 *   2. alice 发起通话 → bob 接听（bob 通话中）
 *   3. alice 通过 UI 创建会议并邀请 bob
 *   4. bob 不应看到会议邀请弹窗（auto-reject）
 *
 * 前置：Go server :18080 + Vite preview :15173
 * 运行：E2E_SITE=http://127.0.0.1:15173 E2E_WS=ws://127.0.0.1:18080/ node --import tsx --test --test-force-exit tests/e2e/busy-guard.e2e.mts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://127.0.0.1:15173";
const WS = process.env.E2E_WS ?? "ws://127.0.0.1:18080/";
const ROOM = "e2e-busy-3";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { if (await cond()) return resolve(); } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${desc}`));
      setTimeout(tick, 400);
    };
    tick();
  });
}

async function domClick(page: import("playwright").Page, selector: string, label: string) {
  await page.evaluate(({ sel, lbl }: { sel: string; lbl: string }) => {
    const btn = document.querySelector(sel) as HTMLButtonElement | null;
    if (!btn) throw new Error(`${lbl} 按钮未找到`);
    btn.click();
  }, { sel: selector, lbl: label });
}

test("busy guard: 通话中收到会议邀请自动拒绝", async (t) => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser.close(); });

  async function newClient(name: string) {
    const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
    await ctx.addInitScript((arg: { n: string; token: string; ws: string }) => {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: {
        userId: arg.n, userName: arg.n, userNameExplicit: true, uniqId: `${arg.n}:e2e`,
      } }));
      const s = {
        roomId: ROOM, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: arg.ws, authToken: arg.token,
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false,
      };
      localStorage.setItem("user_settings", JSON.stringify(s));
      (window as unknown as { __clientName: string }).__clientName = arg.n;
    }, { n: name, token: TOKEN, ws: WS });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[${name}] pageerror:`, e.message.slice(0, 200)));
    page.on("console", (msg) => {
      const text = msg.text();
      if (/meeting|invite|busy|reject|call|error/i.test(text)) {
        console.log(`[${name}][console]`, text.slice(0, 220));
      }
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const ok = await page
        .waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (ok) break;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return page;
  }

  const alice = await newClient("alice");
  const bob = await newClient("bob");

  // ── 双端互相发现 ──
  for (const [name, page] of [["alice", alice], ["bob", bob]] as const) {
    await until(`${name} sees others`, async () =>
      (await page.getByRole("button", { name: /语音通话|Voice call/i }).count()) >= 1, 60_000);
    console.log(`[${name}] presence ok`);
  }

  // ═══ 场景：通话中 bob 收到会议邀请 → 自动拒绝 ═══
  console.log("\n── Scenario: call active, meeting invite should be auto-rejected ──");

  // alice 给 bob 发起通话
  await domClick(alice, 'button[aria-label="语音通话"]', "alice 语音通话");
  console.log("[alice] initiated call");

  // bob 接听
  await until("bob sees incoming call", async () =>
    (await bob.getByRole("button", { name: /接听|Accept/i }).count()) >= 1, 15_000);
  await domClick(bob, 'button[aria-label="接听"]', "bob 接听");
  console.log("[bob] accepted call");

  // 等待通话建立
  await new Promise((r) => setTimeout(r, 2000));
  console.log("[bob] is in a call");

  // alice 通过 UI 创建会议
  await domClick(alice, 'button[aria-label="plus"]', "alice plus");
  await alice.waitForTimeout(500);

  // 点击"创建会议"菜单项（使用 DOM click 绕过事件拦截）
  await alice.evaluate(() => {
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
    for (const item of menuItems) {
      const text = item.textContent || '';
      if (text.includes("创建会议")) {
        (item as HTMLElement).click();
        return;
      }
    }
    throw new Error("创建会议 menu item not found");
  });

  // 等待会议创建对话框
  await until("meeting create dialog appears", async () =>
    (await alice.locator('input[placeholder*="会议"]').count()) > 0 ||
    (await alice.locator('[data-testid="meeting-create-dialog"]').count()) > 0, 10_000).catch(async () => {
      console.log("[alice] warn: meeting create dialog not found, checking page state");
      const bodyText = await alice.evaluate(() => document.body.innerText);
      console.log(`[alice] page text preview: ${bodyText.slice(0, 200)}`);
    });

  // 填写会议名称
  const titleInput = alice.locator('input[placeholder*="会议"]').first();
  await titleInput.waitFor({ timeout: 5_000 }).catch(() => console.log("[alice] no title input found"));
  await titleInput.fill("BusyGuardTest").catch(() => console.log("[alice] failed to fill title"));

  // 点击"开始会议"或"进入会议"按钮
  await until("meeting button appears", async () =>
    (await alice.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/i }).count()) > 0, 10_000).catch(async () => {
      console.log("[alice] warn: meeting button not found");
      const buttons = await alice.evaluate(() => {
        return Array.from(document.querySelectorAll("button")).map(b => b.textContent?.trim());
      });
      console.log(`[alice] all buttons: ${buttons.join(", ")}`);
    });

  await alice.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/i }).first().click().catch(() => {
    console.log("[alice] failed to click meeting button");
  });

  // 等待 alice 进入会议（URL 变化或会议 UI 出现）
  await until("alice enters meeting", async () =>
    alice.url().includes("/meeting") ||
    (await alice.evaluate(() => document.body.innerText.includes("会议"))), 30_000).catch(() => {
    console.log("[alice] warn: alice did not enter meeting");
    console.log(`[alice] current URL: ${alice.url()}`);
  });

  // 检查是否在会议中（即使 URL 没变，会议 UI 可能出现）
  const inMeeting = await alice.evaluate(() => {
    // 检查是否有会议相关的 UI 元素
    const text = document.body.innerText;
    return text.includes("会议号") || text.includes("邀请成员") || text.includes("成员");
  });

  if (!inMeeting && !alice.url().includes("/meeting")) {
    throw new Error("alice failed to enter meeting");
  }

  console.log("[alice] entered meeting:", alice.url());

  // alice 打开邀请对话框
  await alice.waitForTimeout(2_000);
  await domClick(alice, '[data-testid="meeting-invite-open"]', "alice invite-open");
  await until("alice sees invite dialog", async () =>
    (await alice.locator('[data-testid="meeting-invite-dialog"]').count()) > 0, 10_000);

  // alice 邀请 bob
  await until("alice sees bob's invite button", async () =>
    (await alice.locator('[data-testid="meeting-invite-button-bob:e2e"]').count()) > 0, 10_000);
  await domClick(alice, '[data-testid="meeting-invite-button-bob:e2e"]', "alice invite bob");
  console.log("[alice] invited bob");

  // ── 断言：bob 不应看到会议邀请弹窗 ──
  await bob.waitForTimeout(5_000);
  const bobHasInviteAccept = await bob.locator('[data-testid="meeting-invite-accept"]').count();
  assert.equal(bobHasInviteAccept, 0, "bob should NOT see meeting invite accept button while in a call");
  console.log("✓ bob did NOT see meeting invite dialog (auto-rejected)");

  // ── 挂断通话 ──
  await bob.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const hangupBtn = buttons.find(btn => {
      const svg = btn.querySelector("svg");
      if (!svg) return false;
      const transform = svg.getAttribute("style") || "";
      return transform.includes("rotate(135deg)");
    });
    if (hangupBtn) hangupBtn.click();
  });
  await bob.waitForTimeout(2_000);
  console.log("[bob] ended call");

  console.log("\n── SCENARIO PASSED ──");
});
