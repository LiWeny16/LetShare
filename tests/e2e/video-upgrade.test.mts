/**
 * 本地 E2E：视频通话升级功能验证（摄像头选择 / 画中画拖拽+交换 / 码率档位 / 背景模糊）。
 *
 * 覆盖：
 *   1. 视频通话建立（fake camera/mic）
 *   2. 视频设置面板：摄像头下拉列出 fake 设备，切换后通话保持、设置持久化
 *   3. 码率档位热更新（选 750kbps）无异常
 *   4. 背景模糊 toggle（Chrome fake 源）降级链兜底无异常
 *   5. 画中画：小窗存在；点击小窗交换主/次画面（srcObject 互换 + 镜像跟随）
 *   6. 小窗拖拽（--pip-x/--pip-y 变化）
 *
 * 需本地：Go server（MODE=local，本脚本自行 go build）+ vite preview。
 * 运行：node --import tsx --test --test-force-exit tests/e2e/video-upgrade.test.mts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const GO_SERVER = join(ROOT, "server");
const GO_PORT = 18087;
const VITE_PORT = 15178;
const room = "videoup";

async function until(cond: () => Promise<boolean>, ms = 40_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("timeout");
}
async function waitHttp(url: string): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    try { const r = await fetch(url); if (r.ok) { console.log(`[ready] ${url} (${Date.now() - t0}ms)`); return; } } catch { }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout waiting http: ${url}`);
}
function killTree(p: ChildProcess | null) {
  if (!p || p.pid == null) return;
  try { p.kill(); } catch { }
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
}

test("视频通话升级：摄像头选择 + 画中画交互 + 码率档位 + 背景模糊", async (t) => {
  const tmpBin = mkdtempSync(join(tmpdir(), "ls-videoup-"));
  let goProc: ChildProcess | null = null;
  let viteProc: ChildProcess | null = null;
  t.after(() => {
    killTree(goProc);
    killTree(viteProc);
    try { rmSync(tmpBin, { recursive: true, force: true }); } catch { }
  });

  // 1. Go server（local 配置）
  console.log("[setup] go build server…");
  const bin = join(tmpBin, process.platform === "win32" ? "s.exe" : "s");
  await new Promise<void>((res, rej) => {
    const p = spawn("go", ["build", "-o", bin, "./cmd/server"], { cwd: GO_SERVER, env: { ...process.env, GOPROXY: "https://goproxy.cn,direct" } });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`go build failed: ${c}`))));
    p.on("error", rej);
  });
  console.log("[setup] go build ok");
  goProc = spawn(bin, [], { cwd: GO_SERVER, env: { ...process.env, MODE: "local", LETSHARE_SERVER_PORT: String(GO_PORT), LETSHARE_TURN_SECRET: "local-dev-turn-secret" } });
  await waitHttp(`http://127.0.0.1:${GO_PORT}/health`);

  // 2. vite preview（构建产物验证，不设 force relay）
  console.log("[setup] vite build…");
  const distDir = join(tmpBin, "dist").replace(/\\/g, "/");
  await new Promise<void>((res, rej) => {
    const p = spawn("node", ["node_modules/vite/bin/vite.js", `build`, `--outDir`, distDir, `--emptyOutDir`, `--logLevel`, `error`], { cwd: ROOT, env: process.env });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`vite build failed: ${c}`))));
    p.on("error", rej);
  });
  console.log("[setup] vite build ok");
  viteProc = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--outDir", distDir, "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, env: process.env });
  await waitHttp(`http://127.0.0.1:${VITE_PORT}/`);
  console.log("[setup] preview ok");

  // 3. 双客户端（fake camera/mic）
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  t.after(async () => { await browser.close(); });

  async function client(name: string) {
    const ctx = await browser.newContext({ permissions: ["microphone", "camera"] });
    await ctx.addInitScript((a: { port: number; room: string; name: string }) => {
      const s = { roomId: a.room, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: `ws://127.0.0.1:${a.port}/`, authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false };
      localStorage.setItem("user_settings", JSON.stringify(s));
      (window as unknown as { __c: string }).__c = a.name;
    }, { port: GO_PORT, room, name });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[${name}] pageerror:`, e.message));
    page.on("console", (msg) => {
      const text = msg.text();
      if (/\[Call\]|startCall|invite|accept|video|应答|来电|接听/i.test(text)) {
        console.log(`[${name}] console:`, text.slice(0, 200));
      }
    });
    for (let t = 0; t < 4; t++) {
      await page.goto(`http://127.0.0.1:${VITE_PORT}/?room=${room}#`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      try { await until(async () => (await page.getByRole("button", { name: /视频通话|Video call/i }).count()) >= 1, 40_000); break; }
      catch { await page.reload().catch(() => undefined); }
    }
    return { ctx, page };
  }

  const alice = await client("alice");
  const bob = await client("bob");

  // 建立视频通话
  console.log("[call] alice 发起视频通话…");
  console.log("[call] alice buttons:", await alice.page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.slice(0, 20) ?? "?").slice(0, 24),
  ));
  console.log("[call] alice cards:", await alice.page.evaluate(() =>
    [...document.querySelectorAll("[data-testid='connected-user']")].map((c) => c.getAttribute("data-user-id")),
  ));
  // 诊断：完整视频约束（含 degradationPreference）在 fake 源上是否可采集
  const gUM = await alice.page.evaluate(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, degradationPreference: "balanced" as never },
      });
      return { ok: true, labels: s.getVideoTracks().map((t) => t.label) };
    } catch (e) {
      return { ok: false, name: (e as Error)?.name, msg: String(e) };
    }
  });
  console.log("[call] gUM probe:", JSON.stringify(gUM));
  await alice.page.getByRole("button", { name: /视频通话|Video call/i }).first().click();
  console.log("[call] bob 待接听…");
  await until(async () => (await bob.page.getByRole("button", { name: /接听|Accept/i }).count()) >= 1, 30_000);
  await bob.page.getByRole("button", { name: /接听|Accept/i }).click();
  console.log("[call] 等待通话面板…");
  // 通话面板出现在双方
  await until(async () => (await alice.page.getByTestId("call-main-video").count()) === 1, 30_000);
  await until(async () => (await bob.page.getByTestId("call-main-video").count()) === 1, 30_000);
  // 媒体流就绪（主画面 srcObject 有视频轨）
  const mainReady = async (page: Page) => page.evaluate(() => {
    const el = document.querySelector<HTMLVideoElement>('[data-testid="call-main-video"]');
    return Boolean(el?.srcObject && el.srcObject.getVideoTracks().length > 0);
  });
  await until(async () => await mainReady(alice.page), 20_000);
  await until(async () => await mainReady(bob.page), 20_000);
  assert.ok(true, "视频通话建立，主画面绑定视频轨");

  // ── 画中画：主=远端、小窗=本地（默认）──
  console.log("[pip] 校验小窗布局…");
  const pipState = async (page: Page) => page.evaluate(() => {
    const main = document.querySelector<HTMLVideoElement>('[data-testid="call-main-video"]');
    const pip = document.querySelector<HTMLElement>('[data-testid="call-pip"]');
    const pipVideo = pip?.querySelector("video");
    return {
      pipDisplay: pip ? getComputedStyle(pip).display : "nosuch",
      // 交换前记录：main/pip 各自的 stream id（交换后应互换）
      mainStreamId: main?.srcObject ? (main.srcObject as MediaStream).id : null,
      pipStreamId: pipVideo?.srcObject ? (pipVideo.srcObject as MediaStream).id : null,
      mainTransform: main?.style.transform ?? "",
      pipTransform: pip?.style.transform ?? "",
      pipX: pip ? getComputedStyle(pip).getPropertyValue("--pip-x").trim() : "",
    };
  });
  const before = await pipState(alice.page);
  assert.notEqual(before.pipDisplay, "none", "小窗应显示（本地预览）");
  assert.ok(before.pipX, "小窗应有初始位置变量");

  // 点击小窗 → 交换主/次画面（srcObject 互换 + 主窗镜像 local）
  await alice.page.getByTestId("call-pip").click();
  await until(async () => (await pipState(alice.page)).mainStreamId === before.pipStreamId, 10_000);
  const after = await pipState(alice.page);
  assert.equal(after.pipStreamId, before.mainStreamId, "交换后小窗显示原主画面流");
  assert.equal(after.pipTransform.includes("scaleX(-1)"), false, "小窗显示远端不应镜像");
  assert.equal(after.mainTransform.includes("scaleX(-1)"), true, "主窗显示本地应镜像");
  // 再点回去恢复
  await alice.page.getByTestId("call-pip").click();
  await until(async () => (await pipState(alice.page)).mainStreamId === before.mainStreamId, 10_000);

  // 小窗拖拽：--pip-x 变化且 clamp 无异常
  const pipBox = alice.page.getByTestId("call-pip");
  const bb = await pipBox.boundingBox();
  assert.ok(bb, "小窗应有布局盒");
  await alice.page.mouse.move(bb!.x + bb!.width / 2, bb!.y + bb!.height / 2);
  await alice.page.mouse.down();
  await alice.page.mouse.move(bb!.x + 120, bb!.y + 80, { steps: 8 });
  await alice.page.mouse.up();
  const afterDrag = (await pipState(alice.page)).pipX;
  assert.ok(afterDrag, "拖拽后 --pip-x 应有值");
  assert.ok(parseFloat(afterDrag) > 40, `拖拽后 x 应右移（got ${afterDrag}px）`);

  // ── 视频设置面板 ──
  console.log("[panel] 打开视频设置…");
  await alice.page.getByRole("button", { name: /视频设置|Video settings/i }).click();
  // 摄像头下拉：fake 设备出现在列表
  await until(async () => (await alice.page.getByRole("button").filter({ hasText: /系统默认|System default/i }).count()) > 0, 10_000);
  const camSelect = alice.page.locator('button[role="combobox"]').filter({ hasText: /系统默认|System default/i }).first();
  await camSelect.click();
  const camOptions = alice.page.locator('[role="option"]');
  await until(async () => (await camOptions.count()) >= 2, 10_000);
  const optionTexts = await camOptions.allTextContents();
  assert.ok(optionTexts.some((s) => /fake|virtual|camera|摄像头/i.test(s)), `摄像头列表应有设备（${optionTexts.join("|")}）`);
  // 选第一个 fake 摄像头 → 通话不崩、脱轨换轨生效
  await camOptions.nth(1).click();
  await until(async () => await mainReady(alice.page), 15_000);
  // 持久化：videoDeviceId 已写入 localStorage
  const stored = await alice.page.evaluate(() => JSON.parse(localStorage.getItem("user_settings") ?? "{}"));
  assert.ok(typeof stored.videoDeviceId === "string" && stored.videoDeviceId, "videoDeviceId 应持久化");

  // 码率档位 → 750kbps（热更新无异常）
  const bitrateSelect = alice.page.locator('button[role="combobox"]').filter({ hasText: /自动|Auto/i }).first();
  await bitrateSelect.click();
  await until(async () => (await alice.page.locator('[role="option"]').filter({ hasText: "750" }).count()) > 0, 10_000);
  await alice.page.locator('[role="option"]').filter({ hasText: "750" }).click();
  const stored2 = await alice.page.evaluate(() => JSON.parse(localStorage.getItem("user_settings") ?? "{}"));
  assert.equal(stored2.videoMaxBitrate, "750", "videoMaxBitrate 应持久化");

  // 背景模糊 → 降级链兜底无异常（fake 源同样应重采成功）
  const bgSelect = alice.page.locator('button[role="combobox"]').filter({ hasText: /原画|Off/i }).first();
  await bgSelect.click();
  await until(async () => (await alice.page.locator('[role="option"]').filter({ hasText: /模糊|Blur/i }).count()) > 0, 10_000);
  await alice.page.locator('[role="option"]').filter({ hasText: /模糊|Blur/i }).click();
  await until(async () => await mainReady(alice.page), 15_000);
  const stored3 = await alice.page.evaluate(() => JSON.parse(localStorage.getItem("user_settings") ?? "{}"));
  assert.equal(stored3.videoBackground, "blur", "videoBackground 应持久化");

  // 面板内容全量断言：分辨率/编码器/降级策略下拉都在
  for (const label of [/分辨率|Resolution/i, /编码器|Codec/i, /降级|Degradation/i]) {
    const n = await alice.page.locator('button[role="combobox"]').filter({ hasText: label }).count();
    assert.ok(n >= 1, `下拉应存在: ${label}`);
  }

  // 挂断清理（挂断按钮无 aria-label，用 DOM 选择器兜底）
  console.log("[call] 挂断…");
  await alice.page.evaluate(() => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === "挂断");
    btn?.click();
  });
  await until(async () => (await alice.page.getByTestId("call-main-video").count()) === 0, 10_000);
  console.log("[video-upgrade] 全部交互验证通过");
});