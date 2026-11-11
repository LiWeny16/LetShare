/**
 * Static test for the "new version available" wiring in index.html and the
 * post-build version stamping in scripts/generate-version-json.cjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexHtml = readFileSync(join(process.cwd(), "index.html"), "utf8");
const generateScript = readFileSync(join(process.cwd(), "scripts", "generate-version-json.cjs"), "utf8");

test("index.html carries the build meta placeholder", () => {
  assert.ok(indexHtml.includes(`<meta name="letshare-build" content="__LETSHARE_BUILD_ID__">`));
});

test("index.html wires the non-blocking update prompt", () => {
  assert.ok(indexHtml.includes("letshare-update-prompt"), "update prompt node id must exist");
  assert.ok(indexHtml.includes("setInterval(checkVersion"), "periodic version check must exist");
  assert.ok(indexHtml.includes("3 * 60 * 1000"), "3-minute poll interval must exist");
});

test("generate-version-json.cjs requires the shared build-id module", () => {
  assert.ok(generateScript.includes("require('./build-id.cjs')"));
});
