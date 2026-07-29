import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routerSource = readFileSync(
  join(process.cwd(), "src", "pages", "index.tsx"),
  "utf8"
);

test("unknown hash routes redirect to the main share page instead of rendering blank", () => {
  assert.match(routerSource, /HashRouter/);
  assert.match(routerSource, /Navigate/);
  assert.match(routerSource, /<Route path="\*" element=\{<Navigate to="\/" replace \/>\} \/>/);
});
