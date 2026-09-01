/**
 * 响亮假音频 role-swap：用 --use-file-for-fake-audio-capture=<响亮440Hz wav>，
 * 检验 E2E"offerer 0 样本"是否为"假麦克风太弱→DTX抑制"的假象。
 * E1 alice 发起 / E2 bob 发起。双方 samplesSent/SamplesReceived 均打印。
 * 若响亮下双方向均有样本 → 原单通是假象；若 offerer 方向仍 0 样本 → 真 bug。
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const LOUD_WAV = "C:\\Users\\onion\\AppData\\Local\\Temp\\loud.bin";
const GO_PORT = 18083;
const VITE_PORT = 15174;

async function until(cond: () => Promise<boolean>, ms = 40_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return; await new Promise((r) => setTimeout(r, 500)); }
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

const tmpBin = mkdtempSync(join(tmpdir(), "ls-loud-"));
let goProc: ChildProcess | null = null;
let viteProc: ChildProcess | null = null;

const probe = (page: import("playwright").Page) => page.evaluate(async () => {
  const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
  const di = (window as unknown as { __lsPc?: () => Record<string, unknown> }).__lsPc;
  const out: { rows: { t: string; ssrc: unknown; smpl: number; pkt: number; disc: number; E: number; conce: number; lost: number; jb: number; byes: number; codecId: unknown }[]; codecs: Record<string, { pt: unknown; mime: unknown }>; sdp: { local: string | null; remote: string | null } } = { rows: [], codecs: {}, sdp: { local: null, remote: null } };
  const di0 = di ? di() : null;
  if (di0) { out.sdp.local = ((di0 as Record<string, unknown>).localSdp as string) ?? null; out.sdp.remote = ((di0 as Record<string, unknown>).remoteSdp as string) ?? null; }
  if (g) {
    const st = await g();
    for (const pair of st) {
      const r = pair[1]; if (r.type === "codec") out.codecs[r.id as string] = { pt: r.payloadType as unknown, mime: r.mimeType as unknown };
    }
    for (const pair of st) {
      const r = pair[1]; const t = r.type;
      if (t !== "inbound-rtp" && t !== "outbound-rtp") continue;
      if (r.kind !== "audio") continue;
      const smpl = t === "inbound-rtp" ? (r.totalSamplesReceived as number ?? 0) : (r.totalSamplesSent as number ?? 0);
      const pkt = t === "inbound-rtp" ? (r.packetsReceived as number ?? 0) : (r.packetsSent as number ?? 0);
      const byes = t === "inbound-rtp" ? (r.bytesReceived as number ?? 0) : (r.bytesSent as number ?? 0);
      out.rows.push({ t, ssrc: r.ssrc, smpl, pkt, disc: r.packetsDiscarded as number ?? 0, E: r.totalAudioEnergy as number ?? 0, conce: r.concealedSamples as number ?? 0, lost: r.packetsLost as number ?? 0, jb: r.jitterBufferDelay as number ?? 0, byes, codecId: r.codecId });
    }
  }
  return out;
});

async function run() {
  const browser = await chromium.launch({
    args: [`--use-file-for-fake-audio-capture=${LOUD_WAV}`, "--use-file-for-fake-video-capture=fake", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  async function client(name: string, room: string) {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    await ctx.addInitScript((a: { port: number; room: string }) => {
      localStorage.setItem("ls_debug_stats", "1");
      const s = { roomId: a.room, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: `ws://127.0.0.1:${a.port}/`, authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false };
      localStorage.setItem("user_settings", JSON.stringify(s));
    }, { port: GO_PORT, room });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.includes("[Call]") || t.includes("ontrack") || t.includes("unmute") || t.includes("mute") || t.includes("bindRemoteStream") || t.includes("CallBar") || t.includes("remote audio"))
        console.log(`[${name}][console]`, t);
    });
    for (let t = 0; t < 4; t++) {
      await page.goto(`http://127.0.0.1:${VITE_PORT}/?room=${room}#`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      try { await until(async () => (await page.getByRole("button", { name: /语音通话/ }).count()) >= 1, 40_000); break; }
      catch { await page.reload().catch(() => undefined); }
    }
    return { ctx, page };
  }
  async function one(label: string, ROOM: string, callerName: string, calleeName: string) {
    const c = await client(callerName, ROOM);
    const l = await client(calleeName, ROOM);
    await c.page.evaluate(() => (document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement).click());
    await until(async () => (await l.page.getByRole("button", { name: /接听/ }).count()) >= 1, 40_000);
    await l.page.evaluate(() => (document.querySelector('button[aria-label="接听"]') as HTMLButtonElement).click());
    await new Promise((r) => setTimeout(r, 14_000));
    const fmt = (p: { rows: { t: string; ssrc: unknown; smpl: number; pkt: number; disc: number; E: number; conce: number; lost: number; jb: number; byes: number; codecId: unknown }[]; codecs: Record<string, { pt: unknown; mime: unknown }>; sdp: { local: string | null; remote: string | null } }) => {
      const line = (row: { t: string; ssrc: unknown; smpl: number; pkt: number; disc: number; E: number; conce: number; lost: number; jb: number; byes: number; codecId: unknown }) => {
        const ci = p.codecs[row.codecId as string] || {};
        return `s${row.ssrc}:smpl${row.smpl}/pkt${row.pkt}/disc${row.disc}/E${row.E.toFixed(1)}/conce${row.conce}/lost${row.lost}/jb${row.jb}/byes${row.byes}/pt${ci.pt}/mime${ci.mime}`;
      };
      const ml = (sdp: string | null): string => {
        if (!sdp) return "(none)";
        const l = sdp.split("\n"); const m = l.findIndex((x) => x.startsWith("m=audio"));
        if (m < 0) return "(no audio m-line)";
        const seg: string[] = [];
        for (let i = m; i < l.length; i++) { if (i > m && l[i].startsWith("m=")) break; seg.push(l[i]); }
        return seg.join("\n");
      };
      return `IN=${p.rows.filter((r) => r.t === "inbound-rtp").map(line).join(" | ")}\nOUT=${p.rows.filter((r) => r.t === "outbound-rtp").map(line).join(" | ")}\n  LOCAL_audio:\n${ml(p.sdp.local)}\n  REMOTE_audio:\n${ml(p.sdp.remote)}`;
    };
    console.log(`[${label}] ${callerName}(caller):\n${fmt(await probe(c.page))}`);
    console.log(`[${label}] ${calleeName}(callee):\n${fmt(await probe(l.page))}`);
    await browser.contexts()[0]?.close().catch(() => undefined);
    await browser.contexts()[0]?.close().catch(() => undefined);
  }
  console.log("=== LOUD E1: alice 发起 ===");
  await one("loud-a", "loud1", "alice", "bob");
  console.log("=== LOUD E2: 互换 bob 发起 ===");
  await one("loud-b", "loud2", "bob", "alice");
  await browser.close();
}

try {
  const bin = join(tmpBin, process.platform === "win32" ? "s.exe" : "s");
  await new Promise<void>((res, rej) => {
    const p = spawn("go", ["build", "-o", bin, "./cmd/server"], { cwd: join(ROOT, "server"), env: { ...process.env, GOPROXY: "https://goproxy.cn,direct" } });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("go build failed"))));
    p.on("error", rej);
  });
  goProc = spawn(bin, [], { cwd: join(ROOT, "server"), env: { ...process.env, MODE: "local", LETSHARE_SERVER_PORT: String(GO_PORT), LETSHARE_TURN_SECRET: "local-dev-turn-secret" } });
  await waitHttp(`http://127.0.0.1:${GO_PORT}/health`);
  const distDir = join(tmpBin, "dist").replace(/\\/g, "/");
  await new Promise<void>((res, rej) => {
    const p = spawn("node", ["node_modules/vite/bin/vite.js", "build", "--outDir", distDir, "--emptyOutDir", "--logLevel", "error"], { cwd: ROOT, env: process.env });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("vite build failed"))));
    p.on("error", rej);
  });
  viteProc = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--outDir", distDir, "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, env: process.env });
  await waitHttp(`http://127.0.0.1:${VITE_PORT}/`);
  await run();
} finally {
  killTree(viteProc); killTree(goProc);
  try { rmSync(tmpBin, { recursive: true, force: true }); } catch { }
}
process.exit(0);
