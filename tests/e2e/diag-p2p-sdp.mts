/**
 * SDP/SSRC 转储诊断：定位 offerer 静音（P2P 本地）。
 * 只跑一通：alice 发起。转储 alice 的 localDescription SDP(音频 m-line)、
 * bob 的 remoteDescription SDP(音频 m-line) + 双方所有 inbound/outbound-rtp 的 ssrc，
 * 判断是 (a) 编码被压制输出静音 还是 (b) 负载类型/SSRC 协商失配。
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const GO_SERVER = join(ROOT, "server");
const GO_PORT = 18083;
const VITE_PORT = 15174;
const room = "p2psdp";

async function until(cond: () => Promise<boolean>, ms = 40_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout");
}
async function waitHttp(url: string): Promise<void> {
  await until(async () => { try { return (await fetch(url)).ok; } catch { return false; } }, 60_000);
}
function killTree(p: ChildProcess | null) {
  if (!p || p.pid == null) return;
  try { p.kill(); } catch { }
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
}

const tmpBin = mkdtempSync(join(tmpdir(), "ls-sdp-"));
let goProc: ChildProcess | null = null;
let viteProc: ChildProcess | null = null;

try {
  const bin = join(tmpBin, process.platform === "win32" ? "s.exe" : "s");
  await new Promise<void>((res, rej) => {
    const p = spawn("go", ["build", "-o", bin, "./cmd/server"], { cwd: GO_SERVER, env: { ...process.env, GOPROXY: "https://goproxy.cn,direct" } });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("go build failed"))));
    p.on("error", rej);
  });
  goProc = spawn(bin, [], { cwd: GO_SERVER, env: { ...process.env, MODE: "local", LETSHARE_SERVER_PORT: String(GO_PORT), LETSHARE_TURN_SECRET: "local-dev-turn-secret" } });
  await waitHttp(`http://127.0.0.1:${GO_PORT}/health`);

  const distDir = join(tmpBin, "dist").replace(/\\/g, "/");
  await new Promise<void>((res, rej) => {
    const p = spawn("node", ["node_modules/vite/bin/vite.js", `build`, `--outDir`, distDir, `--emptyOutDir`, `--logLevel`, `error`], { cwd: ROOT, env: process.env });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("vite build failed"))));
    p.on("error", rej);
  });
  viteProc = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--outDir", distDir, "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, env: process.env });
  await waitHttp(`http://127.0.0.1:${VITE_PORT}/`);

  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  async function client(name: string) {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    await ctx.addInitScript((a: { port: number; room: string; name: string }) => {
      localStorage.setItem("ls_debug_stats", "1");
      const s = { roomId: a.room, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: `ws://127.0.0.1:${a.port}/`, authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false };
      localStorage.setItem("user_settings", JSON.stringify(s));
      (window as unknown as { __c: string }).__c = a.name;
    }, { port: GO_PORT, room, name });
    const page = await ctx.newPage();
    for (let t = 0; t < 4; t++) {
      await page.goto(`http://127.0.0.1:${VITE_PORT}/?room=${room}#`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      try { await until(async () => (await page.getByRole("button", { name: /语音通话/ }).count()) >= 1, 40_000); break; }
      catch { await page.reload().catch(() => undefined); }
    }
    return { ctx, page };
  }

  const alice = await client("alice");
  const bob = await client("bob");
  await alice.page.evaluate(() => (document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement).click());
  await until(async () => (await bob.page.getByRole("button", { name: /接听/ }).count()) >= 1, 40_000);
  await bob.page.evaluate(() => (document.querySelector('button[aria-label="接听"]') as HTMLButtonElement).click());
  await new Promise((r) => setTimeout(r, 14_000));

  const dump = (await alice.page.evaluate(async () => {
    const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
    const out: Record<string, unknown> = {};
    if (g) {
      const st = await g();
      const audio = { inbound: [] as object[], outbound: [] as object[], source: null as object | null, sender: null as object | null };
      for (const [, r] of st) {
        if (r.kind !== "audio") continue;
        if (r.type === "inbound-rtp") audio.inbound.push({ ssrc: r.ssrc, pt: r.codecId ?? null, rxE: r.totalAudioEnergy ?? 0, pkt: r.packetsReceived ?? 0, concealed: r.concealedSamples ?? 0 });
        if (r.type === "outbound-rtp") audio.outbound.push({ ssrc: r.ssrc, pt: r.codecId ?? null, txE: r.totalAudioEnergy ?? 0, pkt: r.packetsSent ?? 0 });
        if (r.type === "media-source" && r.kind === "audio") audio.source = { srcE: r.totalAudioEnergy ?? 0 };
      }
      out.audio = audio;
    }
    return out;
  })) as { audio: { inbound: {ssrc:number;pt:string|null;rxE:number;pkt:number;concealed:number}[]; outbound: {ssrc:number;pt:string|null;txE:number;pkt:number}[]; source: {srcE:number}|null } };

  const dumpBob = (await bob.page.evaluate(async () => {
    const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
    const out: Record<string, unknown> = {};
    if (g) {
      const st = await g();
      const audio = { inbound: [] as object[], source: null as object | null };
      for (const [, r] of st) {
        if (r.kind !== "audio") continue;
        if (r.type === "inbound-rtp") audio.inbound.push({ ssrc: r.ssrc, rxE: r.totalAudioEnergy ?? 0, pkt: r.packetsReceived ?? 0, concealed: r.concealedSamples ?? 0 });
        if (r.type === "media-source" && r.kind === "audio") audio.source = { srcE: r.totalAudioEnergy ?? 0 };
      }
      out.audio = audio;
    }
    return out;
  })) as { audio: { inbound: {ssrc:number;rxE:number;pkt:number;concealed:number}[]; source:{srcE:number}|null } };

  console.log("ALICE(caller, offerer):", JSON.stringify(dump.audio));
  console.log("BOB(callee, answerer):", JSON.stringify(dumpBob.audio));

  // 双方 codec 表（按 stats 的 codecId 索引），交叉比对 outbound/inbound 的 pt(cid) 指向。
  const codecOf = (page: import("playwright").Page) => page.evaluate(async () => {
    const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
    const c: Record<string, unknown> = {};
    if (g) {
      const st = await g();
      for (const [, r] of st) if (r.type === "codec") c[String(r.id)] = { pt: r.payloadType, mime: r.mimeType, fmtp: r.sdpFmtpLine };
    }
    return c;
  });
  const codecsAlice = await codecOf(alice.page);
  const codecsBob = await codecOf(bob.page);
  // 汇总每侧 outbound/inbound 音频 SSRC 实际使用的 payload type
  const ptUsage = await alice.page.evaluate(async () => {
    const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
    const out = { outbound: null as {pt:number;ssrc:number}|null, inbound: null as {pt:number;ssrc:number}|null };
    if (g) {
      const st = await g();
      for (const [, r] of st) {
        if (r.kind !== "audio") continue;
        if (r.type === "outbound-rtp" && !out.outbound) out.outbound = { pt: Number(r.codecId ?? -1), ssrc: Number(r.ssrc ?? -1) };
        if (r.type === "inbound-rtp" && !out.inbound) out.inbound = { pt: Number(r.codecId ?? -1), ssrc: Number(r.ssrc ?? -1) };
      }
    }
    return out;
  });
  console.log("ALICE codecs:", JSON.stringify(codecsAlice));
  console.log("BOB codecs:", JSON.stringify(codecsBob));
  console.log("ALICE SSRC->PT(cid): outbound", JSON.stringify(ptUsage.outbound), "inbound", JSON.stringify(ptUsage.inbound));

  // 转储双方 pc 调试信息：本地/远端 SDP 原文 + sender track 身份（m-line 过滤在 Node 侧做）
  const pcInfo = (page: import("playwright").Page) => page.evaluate(
    () => (window as unknown as { __lsPc?: () => Record<string, unknown> }).__lsPc?.() ?? {},
  );
  const audioMlines = (sdp?: string | null) => {
    if (!sdp) return null;
    const lines = sdp.split("\r\n");
    const out: string[] = [];
    const inAudio = (() => { let on = false; return (l: string) => { if (l.startsWith("m=audio")) on = true; else if (l.startsWith("m=") && !l.startsWith("m=audio")) on = false; return on; }; })();
    for (const l of lines) {
      if (inAudio(l) && /^a=(ssrc|msid|mid|sendrecv|sendonly|recvonly|inactive|ptime|fmtp|rtpmap)/.test(l)) out.push(l);
    }
    return out.length ? out : null;
  };
  const alicePc = await pcInfo(alice.page) as { localSdp?: string; remoteSdp?: string; audSenders?: number; senders?: {hasTrack:boolean;kind:string|null;readyState:string|null;enabled:boolean|null;muted:boolean|null}[] };
  const bobPc = await pcInfo(bob.page) as { localSdp?: string; remoteSdp?: string; audSenders?: number; senders?: {hasTrack:boolean;kind:string|null;readyState:string|null;enabled:boolean|null;muted:boolean|null}[] };
  console.log("ALICE pc:", JSON.stringify({ localAudio: audioMlines(alicePc.localSdp), remoteAudio: audioMlines(alicePc.remoteSdp), audSenders: alicePc.audSenders, senders: alicePc.senders }));
  console.log("BOB pc:", JSON.stringify({ localAudio: audioMlines(bobPc.localSdp), remoteAudio: audioMlines(bobPc.remoteSdp), audSenders: bobPc.audSenders, senders: bobPc.senders }));

  await browser.close();
} finally {
  killTree(viteProc); killTree(goProc);
  try { rmSync(tmpBin, { recursive: true, force: true }); } catch { }
}
process.exit(0);
