#!/usr/bin/env node
/**
 * 测试运行器：跑 tests/ 下所有 *.test.ts。
 *
 * callManager.test.ts 含异步 RTCPeerConnection fake，Node 24 的 `node --test`
 * 子进程模式偶尔因 runner IPC socket 残留而延迟退出（15 个断言全过但进程挂起）。
 * 该文件单独用 --test-force-exit 跑，其余文件正常跑。
 */
const { execFileSync } = require("child_process");
const { readdirSync } = require("fs");
const { join } = require("path");

const testsDir = join(__dirname, "..", "tests");
const all = readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

const special = ["callManager.test.ts"];
const normal = all.filter((f) => !special.includes(f));
const force = all.filter((f) => special.includes(f));

function run(args) {
  try {
    execFileSync(process.execPath, args, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

let ok = true;
if (normal.length) {
  ok = run(["--import", "tsx", "--test", ...normal.map((f) => join(testsDir, f))]) && ok;
}
for (const f of force) {
  ok = run(["--import", "tsx", "--test", "--test-force-exit", join(testsDir, f)]) && ok;
}

process.exit(ok ? 0 : 1);
