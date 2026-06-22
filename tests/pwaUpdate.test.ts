import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexHtml = readFileSync(join(process.cwd(), "index.html"), "utf8");
const viteConfig = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");

test("service worker registration actively checks for updates and reloads controlled tabs", () => {
  assert.match(indexHtml, /updateViaCache:\s*"none"/);
  assert.match(indexHtml, /registration\.update\(\)/);
  assert.match(indexHtml, /setInterval\(checkForUpdate,\s*60 \* 1000\)/);
  assert.match(indexHtml, /navigator\.serviceWorker\.addEventListener\("controllerchange"/);
  assert.match(indexHtml, /hadController/);
  assert.match(indexHtml, /location\.reload\(\)/);
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

test("local app shell is not served stale-first by a runtime cache", () => {
  assert.doesNotMatch(viteConfig, /cacheName:\s*['"]app-cache-v\d+['"]/);
  assert.doesNotMatch(viteConfig, /urlPattern:\s*\/\^\\\/\.\*\\\.\(js\|css\|html\)\$\/,/);
});
