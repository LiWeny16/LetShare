/**
 * 实验：offerer 静音锁死 → 调用 replaceTrack 重锚后 bob 能否听到 alice。
 * 若 rxE 从 0 翻正 → 确认"初始编码锁死为静音、连接后不恢复"，重锚即修复。
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const GO_PORT = 18083;
const VITE_PORT = 15174;
const room = "reanchor";

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

const tmpBin = mkdtempSync(join(tmpdir(), "ls-ran-"));
let goProc: ChildProcess | null = null;
let viteProc: ChildProcess | null = null;

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
  const probe = (page: import("playwright").Page) => page.evaluate(async () => {
    const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
    let rxE = -1, pkt = 0, concealed = 0, rxSamples = 0, rxBytes = 0;
    let txE = -1, txPkt = 0, txSamples = 0, txBytes = 0, qlr = "n/a";
    if (g) {
      const st = await g();
      for (const [, r] of st) {
        if (r.kind !== "audio") continue;
        if (r.type === "inbound-rtp") { rxE = Number(r.totalAudioEnergy ?? 0); pkt = Number(r.packetsReceived ?? 0); concealed = Number(r.concealedSamples ?? 0); rxSamples = Number(r.totalSamplesReceived ?? 0); rxBytes = Number(r.bytesReceived ?? 0); }
        if (r.type === "outbound-rtp") { txE = Number(r.totalAudioEnergy ?? 0); txPkt = Number(r.packetsSent ?? 0); txSamples = Number(r.totalSamplesSent ?? 0); txBytes = Number(r.bytesSent ?? 0); qlr = String(r.qualityLimitationReason ?? "n/a"); }
      }
    }
    return `IN rxE=${+rxE.toFixed(1)} pkt=${pkt} conce=${concealed} smpl=${rxSamples} B=${rxBytes} | OUT txE=${+txE.toFixed(1)} pkt=${txPkt} smpl=${txSamples} B=${txBytes} qlr=${qlr}`;
  });

  const alice = await client("alice");
  const bob = await client("bob");
  await alice.page.evaluate(() => (document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement).click());
  await until(async () => (await bob.page.getByRole("button", { name: /接听/ }).count()) >= 1, 40_000);
  await bob.page.evaluate(() => (document.querySelector('button[aria-label="接听"]') as HTMLButtonElement).click());
  await new Promise((r) => setTimeout(r, 13_000));

  console.log("[BEFORE] bob(callee) hears alice:", await probe(bob.page), "| alice hears bob:", await probe(alice.page));

  // 用全新 getUserMedia 的暖 track replaceTrack（真正换源）
  const f = await alice.page.evaluate(async () => {
    const r = (window as unknown as { __lsFreshen?: () => Promise<{count:number;err?:string}> }).__lsFreshen;
    return r ? await r() : { count: -1 };
  });
  console.log("[freshen alice] ", JSON.stringify(f));
  await new Promise((r) => setTimeout(r, 8_000));
  console.log("[AFTER freshen]  bob(callee) hears alice:", await probe(bob.page), "| alice hears bob:", await probe(alice.page));

  // 再触发一次完整重协商
  const rn = await alice.page.evaluate(async () => {
    const r = (window as unknown as { __lsRenegotiate?: () => Promise<{ok:boolean}> }).__lsRenegotiate;
    return r ? await r() : { ok: false };
  });
  console.log("[renegotiate alice] ok=", rn.ok);
  await new Promise((r) => setTimeout(r, 8_000));
  console.log("[AFTER renegotiate] bob(callee) hears alice:", await probe(bob.page), "| alice hears bob:", await probe(alice.page));

  await browser.close();
} finally {
  killTree(viteProc); killTree(goProc);
  try { rmSync(tmpBin, { recursive: true, force: true }); } catch { }
}
process.exit(0);
