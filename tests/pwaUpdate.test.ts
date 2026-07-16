import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexHtml = readFileSync(join(process.cwd(), "index.html"), "utf8");
const viteConfig = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");
const dotfileFixScript = readFileSync(join(process.cwd(), "scripts", "fix-dotfiles.cjs"), "utf8");

test("service worker registration actively checks for updates and reloads controlled tabs", () => {
  assert.match(indexHtml, /updateViaCache:\s*"none"/);
  assert.match(indexHtml, /registration\.update\(\)/);
  assert.match(indexHtml, /var POLL_MS = 30 \* 1000/);
  assert.match(indexHtml, /setInterval\(function\(\) \{\s*registration\.update\(\)\.catch\(function\(\) \{\}\);\s*\}, POLL_MS\)/);
  assert.match(indexHtml, /navigator\.serviceWorker\.addEventListener\("controllerchange"/);
  assert.match(indexHtml, /hadController/);
  assert.match(indexHtml, /location\.reload\(\)/);
});

test("first-load fallback allows cold bundle startup before showing the error screen", () => {
  assert.match(indexHtml, /var APP_BOOT_TIMEOUT_MS = 20000/);
  assert.match(indexHtml, /setTimeout\(showError, APP_BOOT_TIMEOUT_MS\)/);
  assert.match(indexHtml, /tagName === "SCRIPT" \|\| tagName === "LINK"/);
  assert.match(indexHtml, /isCriticalAsset\) showError\(\)/);
});

test("production http traffic is upgraded before the app boots", () => {
  assert.match(indexHtml, /location\.protocol === "http:"/);
  assert.match(indexHtml, /location\.hostname === "letshare\.fun"/);
  assert.match(indexHtml, /location\.replace\("https:\/\/letshare\.fun" \+/);
  assert.ok(
    indexHtml.indexOf("location.protocol === \"http:\"") <
      indexHtml.indexOf("<script type=\"module\" src=\"/src/main.tsx\"></script>"),
    "the HTTPS upgrade must run before loading the React bundle"
  );
});

test("initial loading shell uses stable dimensions before React boots", () => {
  assert.match(indexHtml, /#app-loading\s*\{[\s\S]*height:\s*100vh/);
  assert.match(indexHtml, /@supports \(height:\s*100svh\)/);
  assert.match(indexHtml, /#app-loading,\s*#app-error\s*\{[\s\S]*height:\s*100svh/);
  assert.match(indexHtml, /\.loading-card\s*\{[\s\S]*min-height:\s*320px/);
  assert.match(indexHtml, /#app-loading \.loading-card\s*\{[\s\S]*height:\s*320px/);
});

test("local app shell is not served stale-first by a runtime cache", () => {
  assert.doesNotMatch(viteConfig, /cacheName:\s*['"]app-cache-v\d+['"]/);
  assert.doesNotMatch(viteConfig, /urlPattern:\s*\/\^\\\/\.\*\\\.\(js\|css\|html\)\$\/,/);
});

test("build keeps old hashed assets for CDN and service worker overlap", () => {
  assert.match(viteConfig, /emptyOutDir:\s*false/);
});

test("dotfile fixer rewrites retained legacy chunk references", () => {
  assert.doesNotMatch(dotfileFixScript, /dotFiles\.length === 0[\s\S]*process\.exit\(0\)/);
  assert.match(dotfileFixScript, /rewriteLegacyDotReferences/);
});

test("stale chunk cleanup handles Vite hashes that contain hyphens", () => {
  const cleanupScript = readFileSync(join(process.cwd(), "scripts", "cleanup-old-chunks.cjs"), "utf8");
  assert.match(cleanupScript, /function isSingleVersionChunk\(filename, prefix\)/);
  assert.ok(cleanupScript.includes("base.startsWith(`${prefix}-`) && base.endsWith('.js')"));
  assert.match(cleanupScript, /const referenceName = stripGzipSuffix\(filename\)/);
});
