/**
 * WF-003/004 会议核心 P0 双浏览器 E2E：Host 独立生命周期 + 订阅闭环。
 *
 * 流程：Host 创建会议 → Host 独立进入并完成 publish（stage=in-meeting，不等任何成员）→
 *       第二个用户经 URL 直入 meeting 路由 join → Host 发布摄像头（join 即发布）→
 *       Host 共享屏幕（重协商）→ 第二个用户订阅到 Host 摄像头与屏幕两路 track。
 * 反证级联：全程不得出现「房间内不存在发布者」→ joining→idle 级联
 *          （P0 回归：原始房间 membership 被误转发 + 通用 error 帧重置 stage）。
 *
 * 前置：本地 Go server(:8080) + Vite dev(:5173) 已启动。
 * 运行：node --import tsx --test --test-force-exit tests/e2e/meeting-p0.e2e.mts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const ROOM = "e2e-p0-1";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

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

test("WF-003/004: Host 独立 publish → 成员加入订阅 → 屏幕共享重协商 → 控件全程可操作", async (t) => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser.close(); });

  const cascadeErrors: string[] = [];

  async function newClient(name: string) {
    const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
    await ctx.addInitScript((arg: { n: string; token: string; ws: string }) => {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: arg.n, uniqId: `${arg.n}:e2e` } }));
      const s = {
        roomId: "e2e-p0-1", userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: arg.ws, authToken: arg.token,
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false,
        // This regression test exercises bidirectional media publication;
        // the product default is off, so opt into publishing explicitly here.
        meetingCameraDefaultOn: true, meetingMicrophoneDefaultOn: true,
      };
      localStorage.setItem("user_settings", JSON.stringify(s));
    }, { n: name, token: TOKEN, ws: WS });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[${name}] pageerror:`, e.message.slice(0, 200)));
    page.on("console", (msg) => {
      const text = msg.text();
      // 级联指纹：订阅失败 + stage 重置链的任何一环出现即记录
      if (/房间内不存在发布者|暂无已发布 track|参与者.*已关闭|no ice-ufrag|缺少房间/.test(text)) {
        cascadeErrors.push(`[${name}] ${text.slice(0, 200)}`);
      }
      if (/meeting|会议|error|Error|sdp|SDP|ice|ICE/i.test(text)) {
        console.log(`[${name}][console]`, text.slice(0, 200));
      }
    });
    await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
    return page;
  }

  const host = await newClient("alice");
  const guest = await newClient("bob");

  // ── 1. 原始房间 presence 互见（membership 快照场景，级联入口） ──
  for (const [name, page] of [["alice", host], ["bob", guest]] as const) {
    await until(`${name} 看到在线用户`, async () =>
      (await page.evaluate(() => document.querySelectorAll('button[aria-label="语音通话"], button[aria-label="Voice call"]').length)) >= 1, 60_000);
    console.log(`[${name}] presence ok`);
  }

  // ── 2. Host 创建会议并独立进入（WS 弹跳 share→meeting，级联复现路径） ──
  await host.locator('button[aria-label="plus"]').click();
  await host.getByRole("menuitem", { name: /创建会议/ }).click();
  const titleInput = host.getByLabel(/会议名称/);
  await titleInput.waitFor({ timeout: 10_000 });
  await titleInput.fill("P0 验证会议");
  // The current single-dialog flow reserves the meeting first, then changes
  // the same footer action from “开始会议” to “进入会议”.
  await host.getByRole("button", { name: /开始会议|进入会议/ }).click();
  await until("Host 进入 meeting 路由", async () =>
    (await host.evaluate(() => location.hash))?.includes("/meeting"), 20_000);

  // Host 独立完成 publish：不等任何成员，publish PC ICE connected → in-meeting
  await until("Host 独立达成 in-meeting（publish PC 连通，不依赖远端）", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.stage)) === "in-meeting", 40_000);
  const hostState = await host.evaluate(() => {
    const st = (window as any).__meeting.getState();
    return { stage: st.stage, roomId: st.roomId, hostId: st.hostId, members: st.members.length };
  });
  console.log("[alice] host state:", JSON.stringify(hostState));
  const meetingRoomId = String(hostState.roomId);
  assert.match(meetingRoomId, /^\d{4}$/, "会议号为 4 位");
  assert.equal(hostState.hostId, "alice:e2e", "Host 身份来自服务器 meeting:info");

  // ── 3. 第二个用户经 URL 直入（邀请链接路径）并加入 ──
  await guest.evaluate((roomId: string) => { window.location.hash = `#/meeting?room=${roomId}&source=${"e2e-p0-1"}`; }, meetingRoomId);
  await until("bob joinMeeting 启动", async () =>
    (await guest.evaluate(() => (window as any).__meeting?.getState()?.roomId)) === meetingRoomId, 20_000);
  await until("bob 达成 in-meeting", async () =>
    (await guest.evaluate(() => (window as any).__meeting?.getState()?.stage)) === "in-meeting", 40_000);
  console.log("[bob] joined + in-meeting");

  // ── 4. 双向成员表（membership 只含会议频道成员） ──
  await until("Host 成员表包含 bob", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.members?.map((m: any) => m.uniqId)))?.includes("bob:e2e"), 20_000);
  await until("bob 成员表包含 alice", async () =>
    (await guest.evaluate(() => (window as any).__meeting?.getState()?.members?.map((m: any) => m.uniqId)))?.includes("alice:e2e"), 20_000);

  // ── 5. 双向摄像头/音频：不能只验证 Guest 看得到 Host ──
  await until("bob 订阅到 alice 摄像头轨", async () =>
    (await guest.evaluate(() => (window as any).__meeting?.getState()?.remoteTracks?.some((tr: any) =>
      tr.uniqId === "alice:e2e" && tr.kind === "video"))), 30_000);
  await until("bob 订阅到 alice 音频轨", async () =>
    (await guest.evaluate(() => (window as any).__meeting?.getState()?.remoteTracks?.some((tr: any) =>
      tr.uniqId === "alice:e2e" && tr.kind === "audio"))), 30_000);
  await until("alice 订阅到 bob 摄像头轨（反向）", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.remoteTracks?.some((tr: any) =>
      tr.uniqId === "bob:e2e" && tr.kind === "video"))), 30_000);
  await until("alice 订阅到 bob 音频轨（反向）", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.remoteTracks?.some((tr: any) =>
      tr.uniqId === "bob:e2e" && tr.kind === "audio"))), 30_000);
  const renderedCameraVideos = async (page: import("playwright").Page) => page.evaluate(() =>
    Array.from(document.querySelectorAll("video")).filter((video) =>
      (video as HTMLVideoElement).srcObject?.getVideoTracks().some((track) => track.readyState === "live") &&
      (video as HTMLElement).getBoundingClientRect().width > 0
    ).length
  );
  assert.ok(await renderedCameraVideos(host) >= 2, "Host DOM 必须渲染自己的 camera 与 bob 的 camera");
  assert.ok(await renderedCameraVideos(guest) >= 2, "Guest DOM 必须渲染自己的 camera 与 alice 的 camera");
  console.log("[e2e] bidirectional camera + audio tracks reached state and DOM");

  // ── 6. Host 共享屏幕（真实控件点击 + 重协商）→ bob 收到第二路 video ──
  await host.locator('button[aria-label="共享屏幕"], button[aria-label="Share screen"]').first().click();
  await until("Host screenOn=true", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.screenOn)) === true, 20_000);
  await until("bob 收到 alice 屏幕轨（第二路 video）", async () => {
    const tracks = await guest.evaluate(() =>
      (window as any).__meeting?.getState()?.remoteTracks?.filter((tr: any) =>
        tr.uniqId === "alice:e2e" && tr.kind === "video") ?? []);
    return tracks.length >= 2;
  }, 30_000);
  await until("bob DOM 渲染 alice camera + screen 两路远端/本地视频", async () =>
    (await renderedCameraVideos(guest)) >= 3, 30_000);
  console.log("[bob] received alice screen track (renegotiation ok)");
  // 屏幕共享后 Host stage 不回退（重协商失败不得破坏全局状态）
  assert.equal(await host.evaluate(() => (window as any).__meeting?.getState()?.stage), "in-meeting", "屏幕共享后 Host 仍 in-meeting");

  // ── 7. Host 控件全程可操作（静音/摄像头开合） ──
  await host.locator('button[aria-label="静音"], button[aria-label="Mute"]').first().click();
  await until("Host 静音生效", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.muted)) === true, 10_000);
  await host.locator('button[aria-label="解除静音"], button[aria-label="Unmute"]').first().click();
  await until("Host 解除静音", async () =>
    (await host.evaluate(() => (window as any).__meeting?.getState()?.muted)) === false, 10_000);
  assert.equal(await host.evaluate(() => (window as any).__meeting?.getState()?.stage), "in-meeting", "控件操作后 Host 仍 in-meeting");

  // ── 8. 级联反证：全程无 P0 指纹错误 ──
  assert.deepEqual(cascadeErrors, [], `出现级联指纹错误: ${cascadeErrors.join(" | ")}`);

  console.log("[e2e] all P0 checks passed");
});
