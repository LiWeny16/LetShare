#!/usr/bin/env node
/**
 * Local CI — runs the same checks as GitHub Actions CI before pushing.
 *
 * Usage:
 *   node scripts/ci-local.cjs              # run all
 *   node scripts/ci-local.cjs --frontend   # only frontend
 *   node scripts/ci-local.cjs --backend    # only backend
 */

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "server");

function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function run(cmd, opts = {}) { return execSync(cmd, { encoding: "utf-8", cwd: ROOT, stdio: "inherit", ...opts }); }

function check(desc, cmd, opts = {}) {
  log("▶", desc);
  try {
    run(cmd, opts);
    log("✓", desc);
  } catch {
    log("✗", desc);
    process.exitCode = 1;
  }
}

const args = process.argv.slice(2);
const doFrontend = !args.includes("--backend");
const doBackend = !args.includes("--frontend");

console.log("\n  LetShare Local CI\n");

if (doFrontend) {
  console.log("── Frontend ──");
  check("pnpm install --frozen-lockfile (pnpm@9)", "npx -y pnpm@9 install --frozen-lockfile");
  check("TypeScript check", "npx tsc --noEmit");
  check("Unit tests", "npx tsx --test tests/fileMessage-unit.test.ts");
  check("E2E tests", "npx tsx --test tests/fileMessage-e2e.test.ts");
  check("Production build", "npm run build");
}

if (doBackend) {
  console.log("\n── Backend ──");
  check("Go vet", "go vet ./cmd/... ./internal/...", { cwd: SERVER_DIR });
  check("Go test (no race, Windows compat)", "go test ./internal/... -count=1", { cwd: SERVER_DIR });
  check("Go build", "go build ./cmd/server/", { cwd: SERVER_DIR });
}

if (process.exitCode) {
  console.log("\n  ✗ CI FAILED — fix before pushing.\n");
  process.exit(1);
}
console.log("\n  ✓ CI PASSED — safe to push.\n");