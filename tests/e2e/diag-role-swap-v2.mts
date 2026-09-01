/**
 * 决定性实验 v2：静音方向是否跟随 caller 角色。
 * - 每通用全新独立浏览器 context（避免同页热状态/挂断干扰）
 * - 静音判断用 media-source 能量（发端采集）+ inbound totalAudioEnergy（收端解码）
 *   + WebAudio 实测 <audio> 远端流 RMS（最终"听感"）三路交叉
 */
import { chromium } from "playwright";

const SITE = "https://letshare.fun";
const ROOM_PREFIX = "sw";

async function until(cond: () => Promise<boolean>, ms = 40_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout");
}

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

async function client(name: string, room: string) {
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  await ctx.addInitScript((r: string) => {
    localStorage.setItem("ls_force_relay", "1");
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: r, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
      customServerUrl: "wss://ecs.letshare.fun/", authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
      ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false,
    }));
  }, room);
  const page = await ctx.newPage();
  for (let a = 0; a < 4; a++) {
    await page.goto(`${SITE}/?room=${room}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await until(async () => (await page.getByRole("button", { name: /语音通话|Voice call/i }).count()) >= 1, 45_000);
      break;
    } catch { await page.reload().catch(() => undefined); }
  }
  return { ctx, page };
}

/** 三路能量采样 */
async function probe(page: import("playwright").Page): Promise<string> {
  return page.evaluate(async () => {
    const getStats = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
    const out: Record<string, unknown> = {};
    if (getStats) {
      const stats = await getStats();
      let srcE = 0, rxE = 0, rxPkt = 0, concealed = 0;
      for (const [, r] of stats) {
        if (r.type === "media-source" && r.kind === "audio") srcE = Number(r.totalAudioEnergy ?? 0);
        if (r.type === "inbound-rtp" && r.kind === "audio") {
          rxE = Number(r.totalAudioEnergy ?? 0);
          rxPkt = Number(r.packetsReceived ?? 0);
          concealed = Number(r.concealedSamples ?? 0);
        }
      }
      out.stats = { srcE: +srcE.toFixed(3), rxE: +rxE.toFixed(3), rxPkt, concealed };
    }
    // WebAudio 实测 <audio> 远端流 RMS（听感音量）
    let rms = -1;
    const el = document.querySelector("audio");
    if (el && (el.srcObject as MediaStream | null)?.getAudioTracks?.().length) {
      rms = await new Promise<number>((resolve) => {
        try {
          const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ac = new AC();
          const src = ac.createMediaStreamSource(el.srcObject as MediaStream);
          const an = ac.createAnalyser();
          an.fftSize = 2048;
          src.connect(an);
          const buf = new Float32Array(an.fftSize);
          setTimeout(() => {
            an.getFloatTimeDomainData(buf);
            let sum = 0;
            for (const v of buf) sum += v * v;
            ac.close();
            resolve(Math.sqrt(sum / buf.length) * 4000); // 放大到可读
          }, 900);
        } catch (e) { resolve(-2); }
      });
    }
    out.heard = rms;
    return JSON.stringify(out);
  });
}

async function runCall(label: string, ROOM: string, callerName: string, calleeName: string) {
  const caller = await client(`${callerName}-${label}`, ROOM);
  const callee = await client(`${calleeName}-${label}`, ROOM);
  await caller.page.evaluate(() => (document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement).click());
  await until(async () => (await callee.page.getByRole("button", { name: /接听|Accept/i }).count()) >= 1);
  await callee.page.evaluate(() => (document.querySelector('button[aria-label="接听"]') as HTMLButtonElement).click());
  await new Promise((r) => setTimeout(r, 14_000));
  const c = await probe(caller.page);
  const l = await probe(callee.page);
  console.log(`[${label}] ${callerName}(caller): ${c}`);
  console.log(`[${label}] ${calleeName}(callee): ${l}`);
  await browser.contexts()[0]?.close().catch(() => undefined);
  await browser.contexts()[0]?.close().catch(() => undefined);
}

console.log("=== E1：alice 发起 ===");
await runCall("alice-ini", "swa", "alice", "bob");
console.log("=== E2：互换，bob 发起 ===");
await runCall("bob-ini", "swb", "bob", "alice");

await browser.close();
process.exit(0);
