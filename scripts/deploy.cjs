#!/usr/bin/env node
/**
 * LetShare 一键部署脚本
 * 部署前后端到 ecs.letshare.fun
 *
 * 用法:
 *   node scripts/deploy.cjs              # 部署全栈
 *   node scripts/deploy.cjs --frontend   # 仅部署前端
 *   node scripts/deploy.cjs --backend    # 仅部署后端
 *   node scripts/deploy.cjs --dry-run    # 预览将要执行的操作
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CONFIG = {
  remote: { host: "ecs.letshare.fun", user: "root", port: 22 },
  serverDir: "/app/letshare-server",
  webDir: "/app/letshare-web",
};

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "server");
const FRONTEND_DIST = path.join(ROOT, "docs");

// ─── 工具 ────────────────────────────────────────────────
function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function run(cmd, opts = {}) { return execSync(cmd, { encoding: "utf-8", cwd: ROOT, ...opts }); }
function ssh(cmd) { return run(`ssh ${CONFIG.remote.user}@${CONFIG.remote.host} "${cmd}"`, { stdio: "pipe" }); }
function scp(local, remote) { run(`scp "${local}" ${CONFIG.remote.user}@${CONFIG.remote.host}:${remote}`, { stdio: "inherit" }); }

// ─── 构建后端 (Go → Linux binary) ───────────────────────
function buildBackend() {
  log("▶", "构建 Go 后端 (linux/amd64)...");
  const output = path.join(SERVER_DIR, "letshare-server-linux");
  run(`set GOOS=linux&& set GOARCH=amd64&& set CGO_ENABLED=0&& go build -o "${output}" cmd/server/main.go`, { cwd: SERVER_DIR, stdio: "pipe" });
  const mb = (fs.statSync(output).size / 1048576).toFixed(1);
  log("✓", `构建完成: letshare-server-linux (${mb} MB)`);
  return output;
}

// ─── 构建前端 ────────────────────────────────────────────
function buildFrontend() {
  log("▶", "构建前端 (Vite)...");
  run("set CI=true&& pnpm install --frozen-lockfile", { stdio: "pipe" });
  run("pnpm build", { stdio: "pipe" });
  log("✓", `构建完成: ${FRONTEND_DIST}`);
}

// ─── 部署后端 ────────────────────────────────────────────
function deployBackend(binary) {
  log("▶", "部署后端...");
  scp(binary, `${CONFIG.serverDir}/letshare-server-linux`);
  ssh(`cp ${CONFIG.serverDir}/letshare-server ${CONFIG.serverDir}/letshare-server.bak; cp ${CONFIG.serverDir}/letshare-server-linux ${CONFIG.serverDir}/letshare-server; chmod +x ${CONFIG.serverDir}/letshare-server; cd ${CONFIG.serverDir}; docker-compose down; docker-compose up -d`);
  log("✓", "后端部署完成，Docker 已重启");
}

// ─── 部署前端 ────────────────────────────────────────────
function deployFrontend() {
  log("▶", "部署前端...");
  ssh(`mkdir -p ${CONFIG.webDir}`);
  run(`scp -r "${FRONTEND_DIST}\\*" ${CONFIG.remote.user}@${CONFIG.remote.host}:${CONFIG.webDir}/`, { stdio: "inherit" });
  ssh("nginx -s reload 2>/dev/null && echo NGINX_OK || true");
  log("✓", `前端部署完成 → https://${CONFIG.remote.host}/`);
}

// ─── 健康检查 ────────────────────────────────────────────
function healthCheck() {
  log("▶", "健康检查...");
  try {
    run("timeout /t 5 >nul", { stdio: "pipe" });
    const res = run(`curl -sk -o NUL -w "%{http_code}" "https://${CONFIG.remote.host}/health"`, { stdio: "pipe" }).trim();
    log(res === "200" ? "✓" : "⚠", `后端状态: ${res}`);
    const web = run(`curl -sk -o NUL -w "%{http_code}" "https://${CONFIG.remote.host}/"`, { stdio: "pipe" }).trim();
    log(web === "200" ? "✓" : "⚠", `前端状态: ${web}`);
  } catch { log("⚠", "curl 不可用，跳过健康检查"); }
}

// ─── 主流程 ──────────────────────────────────────────────
async function main() {
  const a = process.argv.slice(2);
  const doFrontend = !a.includes("--backend");
  const doBackend = !a.includes("--frontend");
  const dry = a.includes("--dry-run");

  console.log(`\n  LetShare Deploy → ${CONFIG.remote.host}${dry ? " [DRY-RUN]" : ""}\n`);
  const t0 = Date.now();

  let binary = null;
  if (doBackend) binary = buildBackend();
  if (doFrontend) buildFrontend();

  if (dry) { log("ℹ", "DRY-RUN 完成，跳过部署"); return; }

  console.log("");
  if (doBackend && binary) deployBackend(binary);
  if (doFrontend) deployFrontend();

  console.log("");
  healthCheck();

  console.log(`\n  ✓ 完成! 耗时 ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
}

main().catch(e => { console.error(`\n  ✗ 失败: ${e.message}\n`); process.exit(1); });
