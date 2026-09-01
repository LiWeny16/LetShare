/**
 * 本地 P2P 对比：不经 TURN（不设 ls_force_relay），双浏览器连本地 Go server。
 * 判定：P2P 也单通 → 编码/协商固有；P2P 正常 → forced-relay 的中继路径引入。
 *
 * 需本地：Go server(MODE=local) + vite preview。本脚本自行拉起。
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
const room = "p2pdiag";

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

const tmpBin = mkdtempSync(join(tmpdir(), "ls-p2p-"));
let goProc: ChildProcess | null = null;
let viteProc: ChildProcess | null = null;

try {
  // 1. Go server（local 配置，TURN secret 起但 P2P 不会用它）
  const bin = join(tmpBin, process.platform === "win32" ? "s.exe" : "s");
  await new Promise<void>((res, rej) => {
    const p = spawn("go", ["build", "-o", bin, "./cmd/server"], { cwd: GO_SERVER, env: { ...process.env, GOPROXY: "https://goproxy.cn,direct" } });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("go build failed"))));
    p.on("error", rej);
  });
  goProc = spawn(bin, [], { cwd: GO_SERVER, env: { ...process.env, MODE: "local", LETSHARE_SERVER_PORT: String(GO_PORT), LETSHARE_TURN_SECRET: "local-dev-turn-secret" } });
  // 探 /health（进程起来即 200），不依赖 TURN 中继绑定成功与否。
  await waitHttp(`http://127.0.0.1:${GO_PORT}/health`);

  // 2. vite preview（本地构建到临时 dist，指向不设 force relay，靠 localStorage 连本地 server）
  const distDir = join(tmpBin, "dist").replace(/\\/g, "/");
  await new Promise<void>((res, rej) => {
    const p = spawn("node", ["node_modules/vite/bin/vite.js", `build`, `--outDir`, distDir, `--emptyOutDir`, `--logLevel`, `error`], { cwd: ROOT, env: process.env });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("vite build failed"))));
    p.on("error", rej);
  });
  viteProc = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--outDir", distDir, "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, env: process.env });
  await waitHttp(`http://127.0.0.1:${VITE_PORT}/`);

  // 3. 双浏览器 P2P
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  async function client(name: string) {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    await ctx.addInitScript((a: { port: number; room: string; name: string }) => {
      localStorage.setItem("ls_debug_stats", "1"); // 只开 stats 钩子，不开 force_relay → P2P
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

  async function probe(page: import("playwright").Page): Promise<string> {
    return page.evaluate(async () => {
      const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
      let srcE = -1, rxE = -1, rxPkt = 0, candRelay: boolean | null = null;
      if (g) {
        const st = await g();
        for (const [, r] of st) {
          if (r.type === "media-source" && r.kind === "audio") srcE = Number(r.totalAudioEnergy ?? 0);
          if (r.type === "inbound-rtp" && r.kind === "audio") { rxE = Number(r.totalAudioEnergy ?? 0); rxPkt = Number(r.packetsReceived ?? 0); }
          if (r.type === "candidate-pair" && (r.state === "succeeded" || r.nominated === true)) {
            const l = st.get(String(r.localCandidateId ?? "")) as { candidateType?: string } | undefined;
            if (l?.candidateType) candRelay = l.candidateType === "relay";
          }
        }
      }
      return `srcE=${+srcE.toFixed(2)} rxE=${+rxE.toFixed(2)} rxPkt=${rxPkt} relay=${candRelay}`;
    });
  }

  async function one(name: string, callerName: string, calleeName: string) {
    const c = await client(callerName); const l = await client(calleeName);
    await c.page.evaluate(() => (document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement).click());
    await until(async () => (await l.page.getByRole("button", { name: /接听/ }).count()) >= 1, 40_000);
    await l.page.evaluate(() => (document.querySelector('button[aria-label="接听"]') as HTMLButtonElement).click());
    await new Promise((r) => setTimeout(r, 13_000));
    console.log(`[${name}:caller ${callerName}]`, await probe(c.page));
    console.log(`[${name}:callee ${calleeName}]`, await probe(l.page));
    await browser.contexts()[0]?.close().catch(() => undefined);
    await browser.contexts()[0]?.close().catch(() => undefined);
  }

  console.log("=== P2P E1: alice 发起 ===");
  await one("p2p-a", "alice", "bob");
  console.log("=== P2P E2: 互换 bob 发起 ===");
  await one("p2p-b", "bob", "alice");

  await browser.close();
} finally {
  killTree(viteProc); killTree(goProc);
  try { rmSync(tmpBin, { recursive: true, force: true }); } catch { }
}
process.exit(0);
