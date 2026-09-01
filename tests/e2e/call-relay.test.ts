/**
 * E2E：双客户端经本地 Go 后端（WS 信令 + 嵌入式 TURN）完成语音通话。
 *
 * 链路：Playwright 双 browserContext（隔离 localStorage，--use-fake-device-for-media-stream
 * 假麦克风）→ vite build + preview 伺服前端 → 本地 Go 服务器（MODE=local，pion/turn UDP/TCP 3478）。
 * 验证（强制 relay，ls_force_relay=1）：
 *   1. bob 收到来电横幅并接听，双端 ICE connected；
 *   2. 双端 audio inbound-rtp bytesReceived 严格递增（音频字节真的在流动）；
 *   3. selected candidate pair local candidateType === "relay"（媒体经嵌入式 TURN）；
 *
 * 运行：pnpm test:e2e:call
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const GO_SERVER = join(ROOT, "server");
const GO_PORT = 18080; // 避开常用 8080
const VITE_PORT = 15173; // 避开常用 5173
const ROOM = "e2ecall";

let goProc: ChildProcess | null = null;
let viteProc: ChildProcess | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
const tmpBin = mkdtempSync(join(tmpdir(), "letshare-e2e-"));

/** 清理占用指定端口的残留进程（上一轮 E2E 的 preview/server 在 Windows 下树杀不彻底）。 */
async function freePort(port: number, label: string): Promise<void> {
  if (process.platform !== "win32") return;
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTENING"`, { shell: "cmd.exe", encoding: "utf8" });
    const pids = [...new Set(out.split("\n").map((l) => l.trim().split(/\s+/).pop()).filter((p) => p && /^\d+$/.test(p)))];
    for (const pid of pids) {
      console.log(`[e2e] killing stale ${label} pid ${pid} on :${port}`);
      execSync(`taskkill /PID ${pid} /T /F`, { shell: "cmd.exe", stdio: "ignore" });
    }
  } catch {
    // 无占用或 netstat 无匹配 —— 正常
  }
}

/** Windows 下 shell:true 的子进程树 kill 不干净（exe 残留占端口），用 taskkill 树杀兜底。 */
function killTree(proc: ChildProcess | null): void {
  if (!proc || proc.pid == null) return;
  try { proc.kill(); } catch { /* ignore */ }
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
    } catch { /* ignore */ }
  }
}

/** 轮询直到条件为真或超时（ms）。 */
async function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting: ${desc}`);
}

/** 等待 HTTP 端点 200。 */
async function waitHttp(url: string, timeoutMs = 30_000): Promise<void> {
  await until(`HTTP 200 ${url}`, async () => {
    try {
      const r = await fetch(url);
      return r.ok;
    } catch {
      return false;
    }
  }, timeoutMs);
}

test("双客户端经 Go 后端 + 嵌入式 TURN 完成语音通话（强制 relay）", async (t) => {
  // 清理上一轮残留（Windows 树杀不彻底会让 strictPort 端口被占）
  await freePort(GO_PORT, "go-server");
  await freePort(VITE_PORT, "vite-preview");
  await freePort(3478, "turn-listener");
  // ── 1. 起本地 Go 服务器（local 配置模板 + 端口覆盖）──────────────
  const bin = join(tmpBin, process.platform === "win32" ? "server-e2e.exe" : "server-e2e");
  await new Promise<void>((resolve, reject) => {
    const p = spawn("go", ["build", "-o", bin, "./cmd/server"], {
      cwd: GO_SERVER,
      shell: true,
      env: { ...process.env, GOPROXY: "https://goproxy.cn,direct" },
    });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`go build exit ${code}`))));
  });
  t.after(() => { try { rmSync(tmpBin, { recursive: true, force: true }); } catch { /* best effort */ } });

  goProc = spawn(bin, [], {
    cwd: GO_SERVER,
    shell: true,
    env: {
      ...process.env,
      MODE: "local",
      LETSHARE_SERVER_PORT: String(GO_PORT),
      LETSHARE_TURN_SECRET: "e2e-turn-secret",
      LETSHARE_TURN_PUBLIC_IP: "127.0.0.1",
      // TURN 用 local.yaml 默认 3478（uris 与 listener 必须一致，viper 不支持 slice env 覆盖）
      LETSHARE_CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${VITE_PORT}`,
      LETSHARE_LOG_LEVEL: "debug",
    },
  });
  t.after(() => { killTree(goProc); });
  goProc.stdout?.on("data", (d: Buffer) => {
    const line = d.toString();
    // TURN 认证/分配日志（排查 relay 不通）
    if (/turn|TURN|auth|Auth|alloc|Alloc|relay|Relay/.test(line)) console.log("[go]", line.trim().slice(0, 300));
  });

  await waitHttp(`http://127.0.0.1:${GO_PORT}/api/turn-credentials`);
  // TURN listener 必须真的在监听（凭据端点 200 但 TURN 起不来 = relay 必然全挂）
  await until("TURN UDP 3478 监听", async () => {
    try {
      const s = (await import("node:dgram")).createSocket("udp4");
      const resp = await new Promise<boolean>((resolve) => {
        const to = setTimeout(() => { resolve(false); s.close(); }, 2000);
        s.on("message", () => { clearTimeout(to); s.close(); resolve(true); });
        // STUN binding request（魔数 + 交易ID）
        s.send(Buffer.from([0, 1, 0, 0, 0x21, 0x12, 0xa4, 0x42, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 3478, "127.0.0.1");
      });
      return resp;
    } catch {
      return false;
    }
  }, 20_000);
  // 凭据端点必须下发本地 TURN（而非 404）
  const cred = await (await fetch(`http://127.0.0.1:${GO_PORT}/api/turn-credentials`)).json() as { ice_servers: { urls: string }[] };
  assert.ok(cred.ice_servers.length >= 1, "ice_servers 非空");
  assert.match(cred.ice_servers[0].urls, /turn:127\.0\.0\.1:3478/, "TURN URI 指向本地 TURN listener");

  // ── 2. 构建前端到临时目录 + vite preview 伺服 ────────────────────
  // 不用 vite dev：懒加载大模块（share.tsx）冷编译竞态会让第二客户端随机
  // "Failed to fetch dynamically imported module"。preview 伺服静态产物，零竞态。
  const distDir = join(tmpBin, "dist");
  // Windows shell:true 下路径分隔符问题：统一正斜杠（vite/Node 都接受）
  const distDirFwd = distDir.replace(/\\/g, "/");
  await new Promise<void>((resolve, reject) => {
    const p = spawn("node", [`node_modules/vite/bin/vite.js`, `build`, `--outDir`, distDirFwd, `--emptyOutDir`, `--logLevel`, `error`], {
      cwd: ROOT,
      shell: true,
      env: process.env,
    });
    const errOut: string[] = [];
    p.stderr?.on("data", (d: Buffer) => errOut.push(d.toString()));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`vite build exit ${code}: ${errOut.join("").slice(0, 400)}`))));
  });
  const viteBin = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
  viteProc = spawn(viteBin, ["preview", "--outDir", distDirFwd, "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT,
    shell: true,
    env: process.env,
  });
  const viteOut: string[] = [];
  viteProc.stdout?.on("data", (d: Buffer) => viteOut.push(d.toString()));
  viteProc.stderr?.on("data", (d: Buffer) => viteOut.push(d.toString()));
  t.after(() => { killTree(viteProc); });
  try {
    await waitHttp(`http://127.0.0.1:${VITE_PORT}/`, 120_000);
  } catch (e) {
    console.log("[e2e] vite preview output:", viteOut.join("").slice(0, 800));
    throw e;
  }
  // ── 3. 浏览器与双客户端（隔离 context，假麦克风，自动授权）─────────
  browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser?.close(); });

  async function newClient(name: string) {
    const ctx = await browser!.newContext({ permissions: ["microphone"] });
    // 测试钩子注入（须在页面加载前）：强制 relay + TURN API 指向本地 Go + 服务器指向本地 WS
    const initArgs = [name, GO_PORT];
    await ctx.addInitScript((args: [string, number]) => {
      const [n, goPort] = args;
      localStorage.setItem("ls_force_relay", "1");
      localStorage.setItem("ls_turn_api", `http://127.0.0.1:${goPort}`);
      const s = {
        roomId: "e2ecall", userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: `ws://127.0.0.1:${goPort}/`, authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false,
      };
      localStorage.setItem("user_settings", JSON.stringify(s));
      (window as unknown as { __clientName: string }).__clientName = n;
    }, initArgs as unknown as [string, number]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[${name}] pageerror:`, e.message));
    page.on("console", (msg) => {
      const text = msg.text();
      // 收通话/媒体/连接相关日志（中英文都收，排查无声/无 invite）
      if (/call|Call|invite|ws|WebSocket|discover|error|Error|通话|来电|媒体|麦克风/.test(text)) {
        console.log(`[${name}]`, text.slice(0, 220));
      }
    });
    // goto + 就绪重试：确保页面主内容渲染完成（重试兜底偶发加载失败）
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto(`http://127.0.0.1:${VITE_PORT}/?room=${ROOM}#`, { waitUntil: "domcontentloaded" });
      const ok = await page
        .waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (ok) break;
      console.log(`[${name}] page not ready (attempt ${attempt + 1}), retrying goto`);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return { ctx, page };
  }

  const alice = await newClient("alice");
  const bob = await newClient("bob");
  const pages = [alice.page, bob.page];

  // 双页入房完成：连接建立后各自 discover，用户卡片出现对方
  for (const page of pages) {
    await until("用户卡片出现（发现对方）", async () => {
      return (await page.getByRole("button", { name: /语音通话|Voice call/i }).count()) >= 1;
    }, 45_000);
  }

  // ── 4. alice 发起语音通话，bob 接听 ─────────────────────────────
  // 点击用页面内 DOM 原生 click（evaluate）：MUI Tooltip 包裹的按钮上
  // Playwright 的鼠标级 click 偶发不触发 React 合成事件（tooltip 拦截 hover 焦点），
  // DOM click 直达 React onClick，行为等价且稳定。
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

  // ── 5. 断言：active + 音频字节流动 + 走 relay ────────────────────
  type Stats = {
    audioBytes: number;
    relay: boolean | null;
  };
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
          const localId = String(r.localCandidateId ?? "");
          const local = stats.get(localId) as { candidateType?: string } | undefined;
          if (local?.candidateType) relay = local.candidateType === "relay";
        }
      }
      return { audioBytes, relay };
    });
  }

  for (const [i, page] of pages.entries()) {
    await until(`client${i} stats 就绪且走 relay`, async () => {
      const s = await sampleStats(page);
      return s.audioBytes >= 0 && s.relay === true;
    }, 60_000);
  }

  // 音频字节递增（真有数据流过 TURN）
  for (const [i, page] of pages.entries()) {
    const a = await sampleStats(page);
    await new Promise((r) => setTimeout(r, 2000));
    const b = await sampleStats(page);
    assert.ok(b.audioBytes > a.audioBytes, `client${i} audio bytesReceived 应递增: ${a.audioBytes} → ${b.audioBytes}`);
  }

  await alice.page.keyboard.press("Escape").catch(() => undefined);
}, 240_000);
