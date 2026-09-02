#!/usr/bin/env node
/**
 * LetShare 一键部署脚本
 * 后端 -> ecs.letshare.fun systemd；前端静态 docs/ -> ECS nginx（CDN 回源口 18081）
 *
 * 用法:
 *   node scripts/deploy.cjs               # 部署全栈
 *   node scripts/deploy.cjs --frontend    # 仅部署前端（推 docs/ 到 ECS）
 *   node scripts/deploy.cjs --backend     # 仅部署后端
 *   node scripts/deploy.cjs --dry-run     # 预览将要执行的操作
 *   node scripts/deploy.cjs --skip-cdn    # 跳过 CDN 刷新（默认: 有 AK 则刷新）
 *
 * CDN 预热/刷新（可选）: 设置环境变量 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET
 * 后会自动调用 RefreshObjectCaches。未设置 AK 则跳过（提示手动刷新）。
 */

const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const CONFIG = {
  remote: { host: "ecs.letshare.fun", user: "root", port: 22 },
  serverBinary: "/root/cloud/letshare-server-linux",
  serverService: "letshare.service",
  frontend: {
    // Aliyun CDN 回源口：ECS nginx vhost 监听 18081，server_name letshare.fun
    originIp: "101.133.108.16",
    originPort: 18081,
    remoteDir: "/var/www/letshare",
  },
};

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "server");
const FRONTEND_DIST = path.join(ROOT, "docs");
const TMP_ZIP = path.join(os.tmpdir(), "letshare-docs.zip");
const TMP_UNZ = path.join(os.tmpdir(), "letshare-unz.py");
const EXTRACTOR = [
  "import tarfile, os, shutil",
  "d = '/var/www/letshare'",
  "shutil.rmtree(d, ignore_errors=True)",
  "os.makedirs(d)",
  "os.chdir(d)",
  "with tarfile.open('/tmp/letshare-docs.zip') as t:",
  "    n = len(t.getmembers())",
  "    t.extractall('.')",
  "print('extracted', n, 'entries')",
].join("\n");

// ─── 工具 ────────────────────────────────────────────────
function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function run(cmd, opts = {}) { return execSync(cmd, { encoding: "utf-8", cwd: ROOT, ...opts }); }
function ssh(cmd) { return run(`ssh -o BatchMode=yes ${CONFIG.remote.user}@${CONFIG.remote.host} "${cmd}"`, { stdio: "pipe" }); }
function scp(local, remote) { run(`scp -o BatchMode=yes "${local}" ${CONFIG.remote.user}@${CONFIG.remote.host}:${remote}`, { stdio: "inherit" }); }

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
  const tmp = `${CONFIG.serverBinary}.new`;
  scp(binary, tmp);
  ssh(`cp ${CONFIG.serverBinary} ${CONFIG.serverBinary}.bak; mv ${tmp} ${CONFIG.serverBinary}; chmod +x ${CONFIG.serverBinary}; systemctl restart ${CONFIG.serverService}`);
  log("✓", "后端部署完成，systemd 已重启");
}

// ─── CDN 刷新（阿里云 OpenAPI RPC 签名）─────────────────
function cdnRefresh() {
  const ak = process.env.ALIYUN_ACCESS_KEY_ID;
  const sk = process.env.ALIYUN_ACCESS_KEY_SECRET;
  if (!ak || !sk) { log("ℹ", "未设置 ALIYUN_ACCESS_KEY_ID/SECRET，跳过 CDN 刷新（部署后请手动刷新或预热）"); return; }

  function enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  }
  const params = {
    AccessKeyId: ak,
    Action: "RefreshObjectCaches",
    Format: "JSON",
    ObjectPath: "https://letshare.fun/",
    ObjectType: "Directory",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2018-05-10",
  };
  const sorted = Object.keys(params).sort();
  const canonical = sorted.map(k => `${enc(k)}=${enc(params[k])}`).join("&");
  const stringToSign = `GET&${enc("/")}&${enc(canonical)}`;
  const sig = crypto.createHmac("sha1", `${sk}&`).update(stringToSign).digest("base64");
  const url = `https://cdn.aliyuncs.com/?${canonical}&${enc("Signature")}=${enc(sig)}`;

  log("▶", "刷新 CDN 缓存 (RefreshObjectCaches: https://letshare.fun/)...");
  https.get(url, res => {
    let body = "";
    res.on("data", d => body += d);
    res.on("end", () => {
      const ok = JSON.parse(body);
      if (ok.RefreshTaskId) log("✓", `CDN 刷新任务已提交: ${ok.RefreshTaskId} (可在控制台查看进度)`);
      else log("⚠", `CDN 刷新响应: ${body}`);
    });
  }).on("error", e => log("⚠", `CDN 刷新失败: ${e.message}`));
}

// ─── 部署前端（推 docs/ → ECS nginx 回源）───────────────
function deployFrontend() {
  log("▶", "打包 docs/ → 上传 ECS nginx 回源口(18081)...");
  // tar（纯归档，无压缩）：GNU tar 不支持 zip 容器，纯 tar 跨平台确定可解（服务器 tarfile 解压）
  const toPosix = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1") : p);
  run(`tar -cf "${toPosix(TMP_ZIP)}" -C "${toPosix(FRONTEND_DIST)}" .`, { stdio: "pipe" });
  fs.writeFileSync(TMP_UNZ, EXTRACTOR);
  scp(TMP_ZIP, "/tmp/letshare-docs.zip");
  scp(TMP_UNZ, "/tmp/letshare-unz.py");
  const out = ssh(`python3 /tmp/letshare-unz.py && rm -f /tmp/letshare-docs.zip /tmp/letshare-unz.py && curl -s -H 'Host: letshare.fun' http://127.0.0.1:18081/ -o /dev/null -w 'origin /: %{http_code}\\n'`);
  log("✓", `已部署到 ${CONFIG.frontend.remoteDir}；${out.trim().split("\n").pop()}`);
  fs.rmSync(TMP_ZIP, { force: true });
  fs.rmSync(TMP_UNZ, { force: true });
}

// ─── 同步构建产物到 git docs/（海外 GitHub Pages 侧）──────
// pre-push 钩子被 --no-verify 跳过时不会重建/提交 docs/，此处兜底保证双端一致
function syncDocs() {
  const st = run("git status -s docs", { stdio: "pipe" }).trim();
  if (!st) { log("✓", "docs/ 无变化，跳过产物同步"); return; }
  log("▶", `同步 docs/ 构建产物到 git（${st.split("\n").length} 个文件；触发 GitHub Pages 海外侧同步）...`);
  run("git add docs", { stdio: "pipe" });
  try {
    run('git commit -m "chore: 同步构建产物到 docs/ (deploy.cjs)"', { stdio: "pipe" });
  } catch {
    run('git -c user.name=LiWeny16 -c user.email=a454888395@gmail.com commit -m "chore: 同步构建产物到 docs/ (deploy.cjs)"', { stdio: "pipe" });
  }
  run("git push origin main --no-verify", { stdio: "pipe" });
  log("✓", "已推送；大陆侧 ECS 已即时生效，海外侧 Pages 约 1-2 分钟后同步");
}

// ─── 健康检查 ────────────────────────────────────────────
function healthCheck() {
  log("▶", "健康检查...");
  try {
    const res = run(`curl -sk -o NUL -w "%{http_code}" "https://${CONFIG.remote.host}/"`, { stdio: "pipe" }).trim();
    log((res === "200" || res === "401") ? "✓" : "⚠", `后端 WebSocket (${CONFIG.remote.host}): ${res}`);
    const origin = run(`curl -sk -o NUL -w "%{http_code}" -H "Host: letshare.fun" "http://${CONFIG.frontend.originIp}:${CONFIG.frontend.originPort}/version.json"`, { stdio: "pipe" }).trim();
    log(origin === "200" ? "✓" : "⚠", `前端回源 ECS (${CONFIG.frontend.originIp}:${CONFIG.frontend.originPort}): ${origin}`);
    const web = run(`curl -sk -o NUL -w "%{http_code}" "https://letshare.fun/version.json"`, { stdio: "pipe" }).trim();
    log(web === "200" ? "✓" : "⚠", `前端线上 (letshare.fun/version.json): ${web}`);
  } catch { log("⚠", "curl 不可用，跳过健康检查"); }
}

// ─── 主流程 ──────────────────────────────────────────────
async function main() {
  const a = process.argv.slice(2);
  const doFrontend = !a.includes("--backend");
  const doBackend = !a.includes("--frontend");
  const dry = a.includes("--dry-run");
  const skipCdn = a.includes("--skip-cdn");

  console.log(`\n  LetShare Deploy → ${CONFIG.remote.host}${dry ? " [DRY-RUN]" : ""}\n`);
  const t0 = Date.now();

  let binary = null;
  if (doBackend) binary = buildBackend();
  if (doFrontend && !a.includes("--no-build")) buildFrontend();

  if (dry) { log("ℹ", "DRY-RUN 完成，跳过部署"); return; }

  console.log("");
  if (doBackend && binary) deployBackend(binary);
  if (doFrontend) {
    deployFrontend();
    if (!skipCdn) cdnRefresh();
    if (!a.includes("--no-sync-docs")) syncDocs();
  }

  console.log("");
  healthCheck();

  console.log(`\n  ✓ 完成! 耗时 ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
}

main().catch(e => { console.error(`\n  ✗ 失败: ${e.message}\n`); process.exit(1); });
