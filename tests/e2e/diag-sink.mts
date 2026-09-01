/**
 * 决定性实验：被叫端远端 track 无 sink → Chromium NetEq 渲染循环不启动 →
 * packet buffer 塞满后全部包在进 jitter buffer 前被丢弃（单通）。
 * 用 RTCPeerConnection monkeypatch 给每个远端 audio track 强挂 <audio> sink，
 * 若 callee smpl 从 0 翻正 → 证明"sink 缺失"是根因（share.tsx accept 竞态把 onRemoteStream 丢掉）。
 * E1 alice 发起 / E2 bob 发起（role-swap 佐证）。
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLoudWav } from "./loudwav.mts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const LOUD_WAV = ensureLoudWav();
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

const tmpBin = mkdtempSync(join(tmpdir(), "ls-sink-"));
let goProc: ChildProcess | null = null;
let viteProc: ChildProcess | null = null;

const probe = (page: import("playwright").Page) => page.evaluate(async () => {
  const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
  const out: string[] = [];
  let sink = String((window as unknown as { __lsSinkAttached?: unknown }).__lsSinkAttached ?? "no");
  const patch = String((window as unknown as { __lsPatchInstalled?: unknown }).__lsPatchInstalled ?? "no");
  const slog = ((window as unknown as { __lsSinkLog?: string[] }).__lsSinkLog ?? []).join(",");
  if (g) {
    const st = await g();
    for (const [, r] of st) {
      if (r.kind !== "audio") continue;
      if (r.type === "inbound-rtp") out.push(`IN s${r.ssrc}:smpl${r.totalSamplesReceived ?? 0}/pkt${r.packetsReceived ?? 0}/disc${r.packetsDiscarded ?? 0}/E${Number(r.totalAudioEnergy ?? 0).toFixed(1)}/emit${r.jitterBufferEmittedCount ?? 0}/jb${r.jitterBufferDelay ?? 0}`);
      if (r.type === "outbound-rtp") out.push(`OUT s${r.ssrc}:pkt${r.packetsSent ?? 0}/B${r.bytesSent ?? 0}`);
    }
  }
  return `patch=${patch} sink=${sink} log=${slog} | ${out.join(" | ")}`;
});

async function run() {
  const browser = await chromium.launch({
    args: [`--use-file-for-fake-audio-capture=${LOUD_WAV}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  async function client(name: string, room: string) {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    await ctx.addInitScript((a: { port: number; room: string }) => {
      localStorage.setItem("ls_debug_stats", "1");
      const s = { roomId: a.room, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: `ws://127.0.0.1:${a.port}/`, authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false };
      localStorage.setItem("user_settings", JSON.stringify(s));
      // —— sink 强挂（prototype 级）：SRD 完成后给每个远端 audio receiver 挂 <audio> ——
      const W = window as unknown as { __lsPatchInstalled?: boolean; __lsSinkAttached?: boolean; __lsSinkLog?: string[] };
      W.__lsSinkLog = [];
      const OrigSRD = RTCPeerConnection.prototype.setRemoteDescription;
      RTCPeerConnection.prototype.setRemoteDescription = function (this: RTCPeerConnection, desc: RTCSessionDescriptionInit | RTCSdpType) {
        const p = OrigSRD.apply(this, [desc as RTCSessionDescriptionInit]);
        p.then(() => {
          W.__lsPatchInstalled = true;
          for (const r of this.getReceivers()) {
            const tr = r.track;
            if (tr && tr.kind === "audio") {
              const el = document.createElement("audio");
              el.autoplay = true;
              el.muted = true; // 生产修复设计：会话内部 sink 静音防双音，验证静音 sink 是否同样驱动渲染
              el.srcObject = new MediaStream([tr]);
              el.style.display = "none";
              (document.body || document.documentElement).appendChild(el);
              W.__lsSinkAttached = true;
              W.__lsSinkLog!.push(`sinked ssrc-track=${tr.id.slice(0, 8)}`);
            }
          }
        }).catch((e) => W.__lsSinkLog!.push("srd-err:" + String(e)));
        return p;
      } as typeof RTCPeerConnection.prototype.setRemoteDescription;
    }, { port: GO_PORT, room });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.includes("[Call]") || t.includes("CallBar")) console.log(`[${name}][console]`, t);
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
    console.log(`[${label}] ${callerName}(caller):`, await probe(c.page));
    console.log(`[${label}] ${calleeName}(callee):`, await probe(l.page));
    await browser.contexts()[0]?.close().catch(() => undefined);
    await browser.contexts()[0]?.close().catch(() => undefined);
  }
  console.log("=== SINK E1: alice 发起 ===");
  await one("sink-a", "sink1", "alice", "bob");
  console.log("=== SINK E2: 互换 bob 发起 ===");
  await one("sink-b", "sink2", "bob", "alice");
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
