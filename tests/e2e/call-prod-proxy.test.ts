/**
 * 生产环境 E2E（跨网变体）：bob 走系统代理（socks5://127.0.0.1:7897），
 * alice 直连——模拟"海外同学 + 国内用户"的接线拓扑。
 *
 * 诚实边界：SOCKS 代理只覆盖 TCP（WS 信令 + TURN 凭据请求），WebRTC 媒体
 * 是浏览器原生 UDP、不经代理。因此本测试验证的是：
 *   - 信令经海外出口时通话协商仍成功
 *   - 双端（不同源 IP）经生产 TURN 中继双向字节/电平/丢包正常
 * 媒体真实跨境路径需 TUN 模式或真实海外节点，此为本地可做的最强模拟。
 *
 * 运行：node --import tsx --test --test-force-exit tests/e2e/call-prod-proxy.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const SITE = "https://letshare.fun";
const PROXY = process.env.E2E_PROXY ?? "socks5://127.0.0.1:7897";
const EXPECTED_BUILD = "2026-09-01T02:08";
const ROOM = "prode2ep";

async function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting: ${desc}`);
}

test("生产环境（代理变体）：bob 信令走海外代理，双端经 TURN 中继双向通话", async (t) => {
  const sentinel = await (await fetch(`${SITE}/version.json`, { cache: "no-store" })).json() as { v: string };
  assert.ok(sentinel.v >= EXPECTED_BUILD, `生产前端为旧构建（${sentinel.v}）`);

  // 代理可用性预检：通过代理拉取凭据端点（海外出口视角）
  const proxied = await fetch("https://ecs.letshare.fun/api/turn-credentials", {
    dispatcher: new (await import("undici")).ProxyAgent(PROXY),
  }).catch(() => null);
  assert.ok(proxied && proxied.ok, `代理 ${PROXY} 无法访问凭据端点——确认系统代理已开启（clash 混合端口）`);

  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser.close(); });

  async function newClient(name: string, useProxy: boolean) {
    const ctx = await browser.newContext({
      permissions: ["microphone"],
      ...(useProxy ? { proxy: { server: PROXY } } : {}),
    });
    await ctx.addInitScript((n: string) => {
      localStorage.setItem("ls_force_relay", "1");
      const s = {
        roomId: "prode2ep", userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
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
      if (/iceConnectionState|error|Error/.test(text)) console.log(`[${name}]`, text.slice(0, 160));
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const ok = await page
        .waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      if (ok) break;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return { ctx, page };
  }

  const alice = await newClient("alice-direct", false); // 国内直连（模拟你）
  const bob = await newClient("bob-proxy", true); // 经海外代理（模拟新加坡同学）
  const pages = [alice.page, bob.page];

  for (const page of pages) {
    await until("用户卡片出现", async () => {
      return (await page.getByRole("button", { name: /语音通话|Voice call/i }).count()) >= 1;
    }, 60_000);
  }

  await alice.page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement | null;
    if (!btn) throw new Error("语音通话按钮未找到");
    btn.click();
  });
  await until("bob（代理端）来电横幅出现", async () => {
    return (await bob.page.getByRole("button", { name: /接听|Accept/i }).count()) >= 1;
  }, 40_000);
  await bob.page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="接听"]') as HTMLButtonElement | null;
    if (!btn) throw new Error("接听按钮未找到");
    btn.click();
  });

  type Stats = { rxBytes: number; txBytes: number; relay: boolean | null; audioLevel: number };
  async function sampleStats(page: import("playwright").Page): Promise<Stats> {
    return page.evaluate(async () => {
      const getStats = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
      if (!getStats) return { rxBytes: -1, txBytes: -1, relay: null, audioLevel: -1 };
      const stats = await getStats();
      let rxBytes = 0, txBytes = 0, audioLevel = 0;
      let relay: boolean | null = null;
      for (const [, r] of stats) {
        if (r.type === "inbound-rtp" && r.kind === "audio") {
          rxBytes += Number(r.bytesReceived ?? 0);
          const lvl = Number(r.audioLevel ?? 0);
          if (lvl > audioLevel) audioLevel = lvl;
        }
        if (r.type === "outbound-rtp" && r.kind === "audio") txBytes += Number(r.bytesSent ?? 0);
        if (r.type === "candidate-pair" && (r.state === "succeeded" || r.nominated === true)) {
          const local = stats.get(String(r.localCandidateId ?? "")) as { candidateType?: string } | undefined;
          if (local?.candidateType) relay = local.candidateType === "relay";
        }
      }
      return { rxBytes, txBytes, relay, audioLevel };
    });
  }

  for (const [i, page] of pages.entries()) {
    await until(`client${i}（${i === 0 ? "直连" : "代理"}）经 TURN 中继连通`, async () => {
      const s = await sampleStats(page);
      return s.rxBytes >= 0 && s.relay === true;
    }, 90_000);
  }
  for (const [i, page] of pages.entries()) {
    const a = await sampleStats(page);
    await new Promise((r) => setTimeout(r, 2000));
    const b = await sampleStats(page);
    assert.ok(b.rxBytes > a.rxBytes, `client${i} rx 递增: ${a.rxBytes}→${b.rxBytes}`);
    assert.ok(b.txBytes > a.txBytes, `client${i} tx 递增: ${a.txBytes}→${b.txBytes}`);
    assert.ok(b.audioLevel > 0, `client${i} audioLevel>0: ${b.audioLevel}`);
    console.log(`[diag:client${i}] rx=${b.rxBytes} tx=${b.txBytes} level=${b.audioLevel.toFixed(3)}`);
  }
}, 300_000);
