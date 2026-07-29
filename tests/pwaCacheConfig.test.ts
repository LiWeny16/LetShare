import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const viteConfigSource = readFileSync(
  join(process.cwd(), "vite.config.ts"),
  "utf8"
);

test("landing entry assets are eligible for the service worker precache", () => {
  assert.doesNotMatch(viteConfigSource, /\*\*\/\*landing\*\.js/);
  assert.doesNotMatch(viteConfigSource, /\*\*\/\*landing\*\.css/);
});
