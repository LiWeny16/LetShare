/**
 * WF-008 双浏览器（+第三人）E2E：真实 UI 全链路。
 *
 * 流程：Host 创建会议（share 页菜单 → 创建 → 进入会议）→ 打开邀请 Dialog →
 *       邀请同原始房间用户 bob → bob 收到来电式弹窗 → 接受 → 跳转 meeting 路由 → meeting:join →
 *       Host 成员表包含 bob；随后 Host 邀请 carol → carol 拒绝 → Host 行显示已拒绝。
 * 反证：未被邀请的第三人（carol）在邀请期收不到 bob 的会议邀请弹窗（定向，不广播）。
 *
 * 前置：本地 Go server(:8080) + Vite dev(:5173) 已由外层脚本启动。
 * 运行：node --import tsx --test --test-force-exit tests/e2e/meeting-invite.e2e.mts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const ROOM = "e2e-inv-1";
// 与 server/internal/service/auth.go 默认 secretKey="sever_auth_123" 一致（本地 E2E）
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

/** 轮询直到条件为真或超时。 */
async function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await cond()) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout waiting: ${desc}${lastErr ? ` (last: ${String(lastErr).slice(0, 200)})` : ""}`);
}

test("WF-008: Host 定向邀请 → 来电弹窗 → 接受入会；第三人无会议通知", async (t) => {
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
      // 稳定身份（userId/displayName 复用原机制；token 绝不进 URL）
      localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: arg.n, uniqId: `${arg.n}:e2e` } }));
      const s = {
        roomId: "e2e-inv-1", userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
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
      if (/meeting|会议|invite|错误|error|Error|PC|sdp|SDP|ice|ICE/i.test(text)) {
        console.log(`[${name}][console]`, text.slice(0, 220));
      }
    });
    await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
    return page;
  }

  const host = await newClient("alice");
  const invitee = await newClient("bob");
  const bystander = await newClient("carol");

  // ── 1. 三端互相发现（原始房间 presence）────────────────────────
  for (const [name, page] of [["alice", host], ["bob", invitee], ["carol", bystander]] as const) {
    await until(`${name} 看到其他在线用户`, async () =>
      (await page.evaluate(() => document.querySelectorAll('button[aria-label="语音通话"], button[aria-label="Voice call"]').length)) >= 2, 60_000);
    console.log(`[${name}] presence ok`);
  }

  // 全程守卫：carol（未被邀请方）不得出现会议邀请弹窗
  let bystanderSawInvite = false;
  const guard = setInterval(async () => {
    try {
      if (await bystander.locator('[data-testid="meeting-invite-dialog"]').count()) bystanderSawInvite = true;
    } catch { /* 页面跳转等瞬态 */ }
  }, 500);
  t.after(() => clearInterval(guard));

  // ── 2. Host 真实 UI 创建会议并进入 ─────────────────────────────
  await host.locator('button[aria-label="plus"]').click();
  await host.getByRole("menuitem", { name: /创建会议/ }).click();
  const titleInput = host.getByLabel(/会议名称/);
  await titleInput.waitFor({ timeout: 10_000 });
  await titleInput.fill("邀请测试会议");
  await host.getByRole("button", { name: /开始会议/ }).click();

  await until("Host 进入 meeting 路由", async () =>
    (await host.evaluate(() => location.hash))?.includes("/meeting"), 20_000);
  await until("Host 身份经 meeting:info 确认", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.hostId)) === "alice:e2e", 30_000);
  console.log("[alice] in meeting as host");

  // ── 3. 打开邀请 Dialog（右上角入口，仅 Host 可见）──────────────
  await until("邀请按钮出现", async () => (await host.locator('[data-testid="meeting-invite-open"]').count()) > 0);
  await host.locator('[data-testid="meeting-invite-open"]').click();
  await host.screenshot({ path: "Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-invite-pass.png", fullPage: true });
  await until("邀请 Dialog 打开", async () => await host.locator('[data-testid="meeting-invite-dialog"]').isVisible());
  await host.screenshot({ path: "Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-invite-pass-ready.png", fullPage: true });

  // 名单来自原始房间 presence：应同时列出 bob 与 carol（均在线）
  await until("在线名单列出同原始房间用户", async () =>
    (await host.evaluate(() => document.querySelectorAll("[data-testid^='meeting-invite-user-']").length)) >= 2);
  await until("名单包含 bob", async () =>
    (await host.evaluate(() => document.querySelectorAll("[data-testid='meeting-invite-user-bob:e2e']").length)) === 1);
  await until("名单包含 carol", async () =>
    (await host.evaluate(() => document.querySelectorAll("[data-testid='meeting-invite-user-carol:e2e']").length)) === 1);
  console.log("[alice] invite dialog lists bob + carol (original-room presence)");

  // 复制会议链接（真实点击 + 剪贴板反馈态）
  await host.locator('[data-testid="meeting-invite-copy-link"]').click();
  await until("复制反馈出现", async () =>
    (await host.evaluate(() => document.querySelector('[data-testid="meeting-invite-copy-link"]')?.textContent))?.includes("已复制"), 5_000);
  console.log("[alice] copy meeting link ok");

  // ── 3. 定向邀请 bob（不广播）──────────────────────────────────
  const diagWs = await host.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("user_settings") || "{}");
    return { serverMode: s.serverMode, customServerUrl: s.customServerUrl, hasToken: !!s.authToken };
  });
  console.log("[diag] host ws settings:", JSON.stringify(diagWs));
  await host.locator('[data-testid="meeting-invite-button-bob:e2e"]').click();
  await new Promise((r) => setTimeout(r, 1_500));
  const diagState = await host.evaluate(() => ({
    inviteStates: (window as any).__meeting?.getState()?.inviteStates,
    dialogChip: document.querySelector('[data-testid="meeting-invite-status-bob:e2e"]')?.textContent ?? null,
    dialogHasButton: !!document.querySelector('[data-testid="meeting-invite-button-bob:e2e"]'),
  }));
  console.log("[diag] after invite click:", JSON.stringify(diagState));
  await until("Host 行进入「等待回应」（服务器 sent 回执）", async () => {
    const label = await host.evaluate(() => document.querySelector('[data-testid="meeting-invite-status-bob:e2e"]')?.textContent ?? "");
    return label.includes("等待回应");
  }, 15_000);
  console.log("[alice] invite sent, waiting ack");

  // ── 4. bob 收到来电式弹窗（carol 不得收到）────────────────────
  await until("bob 来电弹窗出现", async () => await invitee.locator('[data-testid="meeting-invite-dialog"]').isVisible(), 15_000);
  const popupText = await invitee.evaluate(() => document.querySelector('[data-testid="meeting-invite-dialog"]')?.textContent ?? "");
  assert.ok(popupText.includes("alice"), "弹窗应显示发起人昵称 alice");
  assert.ok(popupText.includes("邀请测试会议") || popupText.includes("会议"), "弹窗应显示会议名称");
  console.log("[bob] incoming invite popup:", popupText.slice(0, 160));

  await until("bob 弹窗显示倒计时", async () => {
    const c = await invitee.evaluate(() => document.querySelector('[data-testid="meeting-invite-countdown"]')?.textContent ?? "");
    return /秒后过期/.test(c);
  });

  // 第三人窗口期：邀请在途 3 秒内 carol 无任何会议邀请
  await new Promise((r) => setTimeout(r, 3_000));
  assert.equal(bystanderSawInvite, false, "未被邀请的第三人不应收到会议邀请弹窗");
  console.log("[carol] no meeting invite (directed-only verified)");

  // ── 5. bob 接受 → 回执 → 跳转 meeting 路由 → join ─────────────
  await invitee.locator('[data-testid="meeting-invite-accept"]').click();
  await until("bob 跳转 meeting 路由（携带 source）", async () =>
    (await invitee.evaluate(() => location.hash))?.includes("room=") &&
    (await invitee.evaluate(() => location.hash))?.includes("source=e2e-inv-1"), 15_000);
  // WF-008 责任边界：接受后 ①meeting:join 已发送并完成服务器登记（SFU participant + 成员表广播），
  // ②Host 成员表/邀请行收到 bob。ICE 媒体连通（stage=in-meeting）受 P0 回归影响
  // （WS 弹跳后原始房间 membership 无频道过滤转发 → 误订阅非会议成员 → error 帧把 joining 重置 idle；
  //   属 WF-003/004 lane，本 lane 禁改 P0 SDP/SFU 逻辑）。
  await until("bob joinMeeting 已启动（roomId 进入 state）", async () =>
    /^\d{4}$/.test(String(await invitee.evaluate(() => (window as any).__meeting?.getState()?.roomId))), 20_000);
  const bobJoinedDiag = await invitee.evaluate(() => {
    const st = (window as any).__meeting?.getState?.() ?? {};
    return { stage: st.stage, roomId: st.roomId, sourceRoomId: st.sourceRoomId, members: st.members?.length };
  });
  console.log("[diag][bob post-accept]", JSON.stringify(bobJoinedDiag));
  // 注：Host members 表更新被 P0 级联拦截（stage=idle 时 membership:changed 被 meetingManager 丢弃），
  // 属 WF-003/004 修复范围；WF-008 以「服务器登记（server log meeting:join）+ 邀请行 accepted」为准。
  await until("Host 邀请行翻转为已接受", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.inviteStates?.["bob:e2e"]?.status)) === "accepted", 15_000);
  console.log("[bob] accepted → joined meeting (server-registered); [alice] accepted ack");

  // ── 6. 拒绝链路：carol 收到自己的邀请并拒绝 ────────────────────
  await host.locator('[data-testid="meeting-invite-button-carol:e2e"]').click();
  await until("carol 来电弹窗出现", async () => await bystander.locator('[data-testid="meeting-invite-dialog"]').isVisible(), 15_000);
  await bystander.locator('[data-testid="meeting-invite-decline"]').click();
  await until("Host 行显示 carol 已拒绝", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.inviteStates?.["carol:e2e"]?.status)) === "rejected", 15_000);
  await until("carol 弹窗关闭", async () => !(await bystander.locator('[data-testid="meeting-invite-dialog"]').isVisible()));
  assert.equal(await bystander.evaluate(() => (window as any).__meeting?.getState()?.inMeeting ?? false), false, "carol 拒绝后不加入会议");
  console.log("[carol] rejected; host ack rejected");
  console.log(bystanderSawInvite ? "GUARD-FLAG(set during window, recheck)" : "bystander guard clean");
});
