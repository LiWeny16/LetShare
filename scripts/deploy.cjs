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
  // 实际生产环境路径（systemd service，非 docker）
  serverBinary: "/root/cloud/letshare-server-linux",
  serverService: "letshare.service",
  webDir: "/var/www/html",
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
  // 上传到临时路径，校验后再替换，避免 SCP 中断留下半截二进制
  const tmp = `${CONFIG.serverBinary}.new`;
  scp(binary, tmp);
  ssh(`cp ${CONFIG.serverBinary} ${CONFIG.serverBinary}.bak; mv ${tmp} ${CONFIG.serverBinary}; chmod +x ${CONFIG.serverBinary}; systemctl restart ${CONFIG.serverService}`);
  log("✓", "后端部署完成，systemd 已重启");
}

// ─── 前端（GitHub Pages）────────────────────────────────
// 前端静态文件由 GitHub Pages 服务（letshare.fun），source = main 分支 /docs。
// 发布流程：pnpm build 生成 docs/ → git push origin main → Pages 自动部署。
// ECS 不服务前端（nginx 被 mask，后端守护进程只占 WebSocket 端口）。
function deployFrontend() {
  log("▶", "前端由 GitHub Pages 服务（letshare.fun），需 git push origin main 触发部署");
  log("ℹ", "若已 push main，Pages 会自动从 /docs 部署；此处无需 SCP 到 ECS");
}

// ─── 健康检查 ────────────────────────────────────────────
function healthCheck() {
  log("▶", "健康检查...");
  try {
    run("timeout /t 5 >nul", { stdio: "pipe" });
    // 后端 WebSocket 端点（443 返回 401 表示服务存活且要求 token，属正常）
    const res = run(`curl -sk -o NUL -w "%{http_code}" "https://${CONFIG.remote.host}/"`, { stdio: "pipe" }).trim();
    log((res === "200" || res === "401") ? "✓" : "⚠", `后端 WebSocket (${CONFIG.remote.host}): ${res}`);
    // 前端走 GitHub Pages
    const web = run(`curl -sk -o NUL -w "%{http_code}" "https://letshare.fun/version.json"`, { stdio: "pipe" }).trim();
    log(web === "200" ? "✓" : "⚠", `前端 Pages (letshare.fun/version.json): ${web}`);
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
