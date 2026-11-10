#!/usr/bin/env node
/**
 * Local frontend + backend dev runner (Windows/macOS/Linux, no extra deps).
 *
 * Usage:
 *   node scripts/dev-local.cjs          # Go backend + Vite together
 *   node scripts/dev-local.cjs server   # Go backend only
 *   node scripts/dev-local.cjs web      # Vite only (with backend proxy env)
 *
 * Env:
 *   LETSHARE_DEV_BACKEND_PORT   Go server port (default 8080 — the port the
 *                               frontend hard-codes in localDevServer.ts)
 *   LETSHARE_DEV_BACKEND_HTTP   Overrides the Vite /api/turn-credentials proxy
 *   MODE                        Go config profile (forced to local here)
 *
 * Meeting minutes: put MEETING_AI_* / MEETING_ASR_* keys in server/.env
 * (gitignored). Godotenv loads it because the server runs with cwd=server/.
 * See server/env.meeting.example.
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "server");
const TMP_DIR = path.join(ROOT, ".tmp");
const BACKEND_PORT = Number(process.env.LETSHARE_DEV_BACKEND_PORT || 8080);
const BACKEND_HTTP =
  process.env.LETSHARE_DEV_BACKEND_HTTP || `http://127.0.0.1:${BACKEND_PORT}`;
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

const mode = (process.argv[2] || "all").toLowerCase();
if (!["all", "server", "web"].includes(mode)) {
  console.error(`未知模式: ${mode}（可用: all | server | web）`);
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function log(tag, line) {
  const prefix = tag ? `[${tag}] ` : "  ";
  process.stdout.write(`${prefix}${line}\n`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function waitForHealth(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function pipeTagged(child, tag) {
  const forward = (stream, isErr) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (isErr) process.stderr.write(`[${tag}] ${line}\n`);
        else log(tag, line);
      }
    });
    stream.on("end", () => {
      if (buffer) log(tag, buffer);
    });
  };
  forward(child.stdout, false);
  forward(child.stderr, true);
}

function track(child, name) {
  children.push({ child, name });
  child.on("exit", (code, signal) => {
    const idx = children.findIndex((c) => c.child === child);
    if (idx >= 0) children.splice(idx, 1);
    if (shuttingDown) return;
    if (code !== 0 && code !== null) {
      log(name, `进程退出 code=${code}${signal ? ` signal=${signal}` : ""}`);
      shutdown(code || 1);
    }
  });
  return child;
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) killTree(child.pid);
  setTimeout(() => process.exit(code), 300);
}

function ensureServerEnv() {
  const envPath = path.join(SERVER_DIR, ".env");
  if (fs.existsSync(envPath)) return;
  const sample = path.join(SERVER_DIR, "env.example");
  if (!fs.existsSync(sample)) return;
  fs.copyFileSync(sample, envPath);
  log("dev", "已从 server/env.example 生成 server/.env（本地密钥，已 gitignore）");
}

async function startBackend() {
  const free = await portFree(BACKEND_PORT);
  if (!free) {
    log("server", `端口 ${BACKEND_PORT} 被占用。先释放它，或设置 LETSHARE_DEV_BACKEND_PORT 换端口。`);
    shutdown(1);
    return;
  }
  ensureServerEnv();
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const goBin = process.platform === "win32" ? "go.exe" : "go";
  const env = {
    ...process.env,
    MODE: "local",
    LETSHARE_SERVER_PORT: String(BACKEND_PORT),
    LETSHARE_LOG_LEVEL: process.env.LETSHARE_LOG_LEVEL || "debug",
    // Keep in sync with LOCAL_DEV_SERVER_AUTH_TOKEN in
    // src/app/libs/connection/localDevServer.ts
    SERVER_AUTH_SECRET: process.env.SERVER_AUTH_SECRET || "sever_auth_123",
  };
  log("server", `go run ./cmd/server  (MODE=local, ${BACKEND_HTTP})`);
  const child = spawn(goBin, ["run", "./cmd/server"], {
    cwd: SERVER_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.on("error", (err) => {
    log("server", `启动失败: ${err.code === "ENOENT" ? "未找到 go，可执行文件不在 PATH 中" : err.message}`);
    shutdown(1);
  });
  pipeTagged(child, "server");
  track(child, "server");

  waitForHealth(BACKEND_HTTP).then((ok) => {
    if (shuttingDown) return;
    if (ok) {
      log("server", `就绪 → ${BACKEND_HTTP}/health`);
      const meetingEnv = path.join(SERVER_DIR, ".env");
      if (fs.existsSync(meetingEnv)) {
        const body = fs.readFileSync(meetingEnv, "utf8");
        const hasValue = (name) => {
          // godotenv does not overwrite an explicitly present process variable.
          const inherited = process.env[name];
          const match = body.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*([^\\r\\n]*)`, "m"));
          const value = (inherited ?? match?.[1] ?? "").trim();
          return value !== "" && value !== '""' && value !== "''" && !value.startsWith("#");
        };
        const required = [
          ["MEETING_AI_API_KEY", "SOMNI_LLM_API_KEY"],
          ["MEETING_ASR_STREAM_HTTP_BASE", "SOMNI_ASR_HTTP_BASE"],
          ["MEETING_ASR_STREAM_WS_BASE", "SOMNI_ASR_WS_BASE"],
          ["MEETING_ASR_STREAM_EMAIL", "SOMNI_ASR_EMAIL"],
          ["MEETING_ASR_STREAM_PASSWORD", "SOMNI_ASR_PASSWORD"],
        ];
        if (required.some((aliases) => !aliases.some(hasValue))) {
          log("server", "AI 会议纪要的 Gemini 或 Somni ASR 配置不完整；请参考 server/env.meeting.example。");
        }
      }
    } else {
      log("server", `60s 内未通过 ${BACKEND_HTTP}/health，请检查上方 Go 日志`);
    }
  });
}

function startWeb() {
  if (!fs.existsSync(VITE_BIN)) {
    log("web", `未找到 ${path.relative(ROOT, VITE_BIN)}，请先 pnpm install`);
    shutdown(1);
    return;
  }
  log("web", `vite dev  (proxy /api/turn-credentials → ${BACKEND_HTTP})`);
  const child = spawn(process.execPath, [VITE_BIN], {
    cwd: ROOT,
    env: { ...process.env, LETSHARE_DEV_BACKEND_HTTP: BACKEND_HTTP },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  child.on("error", (err) => {
    log("web", `启动失败: ${err.message}`);
    shutdown(1);
  });
  pipeTagged(child, "web");
  track(child, "web");
}

async function main() {
  if (mode !== "web") await startBackend();
  if (shuttingDown) return;
  if (mode !== "server") startWeb();
  if (children.length === 0) process.exit(1);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => {
  for (const { child } of children) killTree(child.pid);
});

main();
