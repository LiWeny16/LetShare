/**
 * 生产环境 E2E：双客户端经 ecs.letshare.fun（WS 信令 + 生产嵌入式 TURN）语音通话。
 *
 * 与本地 tests/e2e/call-relay.test.ts 的区别：
 *   - 不拉起任何本地服务：前端用已部署的 https://letshare.fun（GitHub Pages），
 *     后端用生产 ecs.letshare.fun（WS + TURN + 凭据端点全部真实生产）
 *   - 前置：生产 version.json 哨兵 >= 本次构建（否则前端是旧版，跳过并失败提示）
 *   - 断言同本地版：双端 ICE connected、音频字节递增、candidateType === "relay"
 *
 * 运行：node --import tsx --test --test-force-exit tests/e2e/call-prod.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const SITE = "https://letshare.fun";
const EXPECTED_BUILD = "2026-09-01T01:49"; // 本次推送的构建哨兵前缀（UTC）
const ROOM = "prode2e";

/** 轮询直到条件为真或超时（ms）。 */
async function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting: ${desc}`);
}

test("生产环境：双客户端经 ecs.letshare.fun 嵌入式 TURN 完成语音通话（强制 relay）", async (t) => {
  // ── 0. 前置：Pages 已部署本次构建 ────────────────────────────────
  const sentinel = await (await fetch(`${SITE}/version.json`, { cache: "no-store" })).json() as { v: string };
  assert.ok(
    sentinel.v >= EXPECTED_BUILD,
    `生产前端还是旧构建（${sentinel.v}，需 >= ${EXPECTED_BUILD}）——GitHub Pages 可能仍在部署，稍后重跑`,
  );

  // ── 1. 双客户端（生产站，custom 服务器模式，强制 relay）───────────
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser.close(); });

  async function newClient(name: string) {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    await ctx.addInitScript((n: string) => {
      localStorage.setItem("ls_force_relay", "1");
      // 不设 ls_turn_api：生产前端默认 API_BASE=ecs.letshare.fun（真实凭据端点）
      const s = {
        roomId: "prode2e", userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: "wss://ecs.letshare.fun/", authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false,
      };
      localStorage.setItem("user_settings", JSON.stringify(s));
      (window as unknown as { __clientName: string }).__clientName = n;
    }, name);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[${name}] pageerror:`, e.message));
    page.on("console", (msg) => {
      const text = msg.text();
      if (/call|Call|invite|error|Error|通话|来电|iceConnection|ICE candidate/.test(text)) {
        console.log(`[${name}]`, text.slice(0, 200));
      }
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded" });
      const ok = await page
        .waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (ok) break;
      console.log(`[${name}] page not ready (attempt ${attempt + 1})`);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return { ctx, page };
  }

  const alice = await newClient("alice");
  const bob = await newClient("bob");
  const pages = [alice.page, bob.page];

  for (const page of pages) {
    await until("用户卡片出现（发现对方）", async () => {
      return (await page.getByRole("button", { name: /语音通话|Voice call/i }).count()) >= 1;
    }, 60_000);
  }

  // ── 2. 发起通话（DOM click：MUI Tooltip 包裹下比鼠标级 click 稳定）──
  await alice.page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement | null;
    if (!btn) throw new Error("语音通话按钮未找到");
    btn.click();
  });
  await until("bob 来电横幅出现", async () => {
    return (await bob.page.getByRole("button", { name: /接听|Accept/i }).count()) >= 1;
  }, 30_000);
  await bob.page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="接听"]') as HTMLButtonElement | null;
    if (!btn) throw new Error("接听按钮未找到");
    btn.click();
  });

  // ── 3. 断言：relay 候选 + 音频字节递增 ───────────────────────────
  type Stats = { audioBytes: number; relay: boolean | null };
  async function sampleStats(page: import("playwright").Page): Promise<Stats> {
    return page.evaluate(async () => {
      const getStats = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
      if (!getStats) return { audioBytes: -1, relay: null };
      const stats = await getStats();
      let audioBytes = 0;
      let relay: boolean | null = null;
      for (const [, r] of stats) {
        if (r.type === "inbound-rtp" && r.kind === "audio") audioBytes += Number(r.bytesReceived ?? 0);
        if (r.type === "candidate-pair" && (r.state === "succeeded" || r.nominated === true)) {
          const local = stats.get(String(r.localCandidateId ?? "")) as { candidateType?: string } | undefined;
          if (local?.candidateType) relay = local.candidateType === "relay";
        }
      }
      return { audioBytes, relay };
    });
  }

  for (const [i, page] of pages.entries()) {
    await until(`client${i} 经生产 TURN 中继连通`, async () => {
      const s = await sampleStats(page);
      return s.audioBytes >= 0 && s.relay === true;
    }, 90_000);
  }

  for (const [i, page] of pages.entries()) {
    const a = await sampleStats(page);
    await new Promise((r) => setTimeout(r, 2000));
    const b = await sampleStats(page);
    assert.ok(b.audioBytes > a.audioBytes, `client${i} audio bytesReceived 应递增: ${a.audioBytes} → ${b.audioBytes}`);
  }
}, 300_000);
