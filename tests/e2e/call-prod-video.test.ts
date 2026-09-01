/**
 * 生产环境 E2E：双客户端「视频通话」经 ecs.letshare.fun 嵌入式 TURN。
 *
 * 与 call-prod.test.ts（语音）同链路，差异：
 *   - 点击"视频通话"按钮（audio+video）
 *   - 断言 audio 与 video 两类 inbound-rtp bytesReceived 均递增
 *     （同一 RTCPeerConnection、max-bundle 复用同一 ICE/TURN 通道）
 *
 * 运行：node --import tsx --test --test-force-exit tests/e2e/call-prod-video.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const SITE = "https://letshare.fun";
const EXPECTED_BUILD = "2026-09-01T02:08"; // 已部署构建哨兵前缀（UTC）
const ROOM = "prode2ev";

async function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting: ${desc}`);
}

test("生产环境：视频通话（音视频同轨）经嵌入式 TURN 强制 relay", async (t) => {
  const sentinel = await (await fetch(`${SITE}/version.json`, { cache: "no-store" })).json() as { v: string };
  assert.ok(sentinel.v >= EXPECTED_BUILD, `生产前端为旧构建（${sentinel.v}），需 >= ${EXPECTED_BUILD}`);

  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser.close(); });

  async function newClient(name: string) {
    const ctx = await browser.newContext({ permissions: ["microphone", "camera"] });
    await ctx.addInitScript((n: string) => {
      localStorage.setItem("ls_force_relay", "1");
      const s = {
        roomId: "prode2ev", userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
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
      if (/ontrack|iceConnectionState|error|Error/.test(text)) {
        console.log(`[${name}]`, text.slice(0, 160));
      }
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded" });
      const ok = await page
        .waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (ok) break;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return { ctx, page };
  }

  const alice = await newClient("alice");
  const bob = await newClient("bob");
  const pages = [alice.page, bob.page];

  for (const page of pages) {
    await until("用户卡片出现（发现对方）", async () => {
      return (await page.getByRole("button", { name: /视频通话|Video call/i }).count()) >= 1;
    }, 60_000);
  }

  // 点击"视频通话"（DOM click：MUI Tooltip 包裹下比鼠标级 click 稳定）
  await alice.page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="视频通话"]') as HTMLButtonElement | null;
    if (!btn) throw new Error("视频通话按钮未找到");
    btn.click();
  });
  await until("bob 来电横幅出现（视频来电）", async () => {
    return (await bob.page.getByRole("button", { name: /接听|Accept/i }).count()) >= 1;
  }, 30_000);
  await bob.page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="接听"]') as HTMLButtonElement | null;
    if (!btn) throw new Error("接听按钮未找到");
    btn.click();
  });

  // 断言：relay 候选 + 音频与视频字节均递增（同一条中继通道承载两种媒体）
  type Stats = { audioBytes: number; videoBytes: number; relay: boolean | null };
  async function sampleStats(page: import("playwright").Page): Promise<Stats> {
    return page.evaluate(async () => {
      const getStats = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
      if (!getStats) return { audioBytes: -1, videoBytes: -1, relay: null };
      const stats = await getStats();
      let audioBytes = 0;
      let videoBytes = 0;
      let relay: boolean | null = null;
      for (const [, r] of stats) {
        if (r.type === "inbound-rtp" && r.kind === "audio") audioBytes += Number(r.bytesReceived ?? 0);
        if (r.type === "inbound-rtp" && r.kind === "video") videoBytes += Number(r.bytesReceived ?? 0);
        if (r.type === "candidate-pair" && (r.state === "succeeded" || r.nominated === true)) {
          const local = stats.get(String(r.localCandidateId ?? "")) as { candidateType?: string } | undefined;
          if (local?.candidateType) relay = local.candidateType === "relay";
        }
      }
      return { audioBytes, videoBytes, relay };
    });
  }

  for (const [i, page] of pages.entries()) {
    await until(`client${i} 视频通话经生产 TURN 中继连通`, async () => {
      const s = await sampleStats(page);
      return s.audioBytes >= 0 && s.videoBytes > 0 && s.relay === true;
    }, 90_000);
  }

  for (const [i, page] of pages.entries()) {
    const a = await sampleStats(page);
    await new Promise((r) => setTimeout(r, 2000));
    const b = await sampleStats(page);
    assert.ok(b.audioBytes > a.audioBytes, `client${i} audio bytesReceived 应递增: ${a.audioBytes} → ${b.audioBytes}`);
    assert.ok(b.videoBytes > a.videoBytes, `client${i} video bytesReceived 应递增: ${a.videoBytes} → ${b.videoBytes}`);
  }
}, 300_000);
