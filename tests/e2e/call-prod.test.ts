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
      await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

  // ── 3. 断言：relay 候选 + 双向音频字节 + 语音电平 + 丢包 ──────────
  // 单通（"听得到对方、对方听不到我"）的三层定位：
  //   层1 字节：bytesSent/bytesReceived 递增 —— 包确实在双向流动（网络/中继 OK）
  //   层2 电平：inbound audioLevel > 0 —— 收到的包里真的有声音（排除"静音包"）
  //   层3 恢复：mute→unmute 后 outbound 恢复递增 —— track.enabled 状态机无残留
  type Stats = {
    rxBytes: number;
    txBytes: number;
    relay: boolean | null;
    audioLevel: number;
    packetsReceived: number;
    packetsLost: number;
  };
  async function sampleStats(page: import("playwright").Page): Promise<Stats> {
    return page.evaluate(async () => {
      const getStats = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
      if (!getStats) return { rxBytes: -1, txBytes: -1, relay: null, audioLevel: -1, packetsReceived: -1, packetsLost: -1 };
      const stats = await getStats();
      let rxBytes = 0;
      let txBytes = 0;
      let relay: boolean | null = null;
      let audioLevel = 0;
      let packetsReceived = 0;
      let packetsLost = 0;
      for (const [, r] of stats) {
        if (r.type === "inbound-rtp" && r.kind === "audio") {
          rxBytes += Number(r.bytesReceived ?? 0);
          packetsReceived += Number(r.packetsReceived ?? 0);
          packetsLost += Number(r.packetsLost ?? 0);
          const lvl = Number(r.audioLevel ?? 0);
          if (lvl > audioLevel) audioLevel = lvl;
        }
        if (r.type === "outbound-rtp" && r.kind === "audio") txBytes += Number(r.bytesSent ?? 0);
        if (r.type === "candidate-pair" && (r.state === "succeeded" || r.nominated === true)) {
          const local = stats.get(String(r.localCandidateId ?? "")) as { candidateType?: string } | undefined;
          if (local?.candidateType) relay = local.candidateType === "relay";
        }
      }
      return { rxBytes, txBytes, relay, audioLevel, packetsReceived, packetsLost };
    });
  }

  for (const [i, page] of pages.entries()) {
    await until(`client${i} 经生产 TURN 中继连通`, async () => {
      const s = await sampleStats(page);
      return s.rxBytes >= 0 && s.relay === true;
    }, 90_000);
  }

  for (const [i, page] of pages.entries()) {
    const a = await sampleStats(page);
    await new Promise((r) => setTimeout(r, 2000));
    const b = await sampleStats(page);
    assert.ok(b.rxBytes > a.rxBytes, `client${i} audio bytesReceived 应递增（听得到对方）: ${a.rxBytes} → ${b.rxBytes}`);
    assert.ok(b.txBytes > a.txBytes, `client${i} audio bytesSent 应递增（对方听得到我）: ${a.txBytes} → ${b.txBytes}`);
    // 电平断言：假麦产生恒定音调，正常应 > 0；若包在流而电平≈0，即"静音包"单通现场
    assert.ok(b.audioLevel > 0, `client${i} inbound audioLevel 应 > 0（收到的包含真实语音电平）: ${b.audioLevel}`);
    // 丢包告警（非硬断言：跨网抖动可能瞬时超阈，打印供诊断）
    const lossRate = b.packetsReceived + b.packetsLost > 0 ? b.packetsLost / (b.packetsReceived + b.packetsLost) : 0;
    console.log(`[diag:client${i}] lossRate=${(lossRate * 100).toFixed(1)}% rx=${b.rxBytes} tx=${b.txBytes} audioLevel=${b.audioLevel.toFixed(3)}`);
  }

  // ── 4. 静音往返：mute → outbound 停/降 → unmute → outbound 恢复递增 ──
  // 复现"点过静音再取消后对方听不到"的 track.enabled 残留 bug 现场。
  for (const page of pages) {
    const before = await sampleStats(page);
    // 静音 1.5s（DOM click 静音按钮）
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[aria-label]'));
      const mute = btns.find((b) => /静音|Mute/i.test(b.getAttribute("aria-label") ?? ""));
      (mute as HTMLButtonElement | undefined)?.click();
    });
    await new Promise((r) => setTimeout(r, 1500));
    const during = await sampleStats(page);
    // 取消静音
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[aria-label]'));
      const unmute = btns.find((b) => /取消静音|Unmute/i.test(b.getAttribute("aria-label") ?? ""));
      (unmute as HTMLButtonElement | undefined)?.click();
    });
    await new Promise((r) => setTimeout(r, 2000));
    const after = await sampleStats(page);
    assert.ok(
      after.txBytes > during.txBytes,
      `静音往返后 outbound 应恢复递增: mute前=${before.txBytes} 静音中=${during.txBytes} 取消后=${after.txBytes}`,
    );
  }
}, 300_000);
