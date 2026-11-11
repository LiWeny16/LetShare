/**
 * Static test for scripts/build-id.cjs (shared by scripts/generate-version-json.cjs).
 * injectBuildId must replace only the letshare-build meta placeholder, leave other
 * occurrences of the token untouched, and throw when the meta is missing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BUILD_ID_TOKEN, injectBuildId, buildIdForHtml } = require("../scripts/build-id.cjs") as {
  BUILD_ID_TOKEN: string;
  injectBuildId: (html: string, buildId: string) => string;
  buildIdForHtml: (html: string, version: string) => string;
};

const META = `<meta name="letshare-build" content="${BUILD_ID_TOKEN}">`;

test("injectBuildId replaces only the meta placeholder", () => {
  const html =
    `<!doctype html><html><head>${META}` +
    `\n<script>var TOKEN = "${BUILD_ID_TOKEN}";</script>` +
    `\n<!-- note: ${BUILD_ID_TOKEN} is also mentioned in a comment --></head><body></body></html>`;
  const out = injectBuildId(html, "test-123");

  assert.ok(out.includes(`<meta name="letshare-build" content="test-123">`), "meta must be stamped");
  assert.ok(out.includes(`<script>var TOKEN = "${BUILD_ID_TOKEN}";</script>`), "other tokens must stay untouched");
  assert.ok(out.includes(`<!-- note: ${BUILD_ID_TOKEN} is also mentioned in a comment -->`), "comments must stay untouched");
  assert.ok(!out.includes(`<meta name="letshare-build" content="${BUILD_ID_TOKEN}">`), "placeholder must be gone");
});

test("injectBuildId throws when the meta placeholder is missing", () => {
  assert.throws(() => injectBuildId("<html><head></head><body></body></html>", "x"), /letshare-build/);
  // The token present elsewhere (without the meta) is not enough.
  assert.throws(
    () => injectBuildId(`<html><script>var T = "${BUILD_ID_TOKEN}";</script></html>`, "x"),
    /letshare-build/
  );
});

const SAMPLE_HTML =
  `<!doctype html><html><head>${META}</head><body><div id="root"></div></body></html>`;
const SAMPLE_VERSION = "3.9.10";

test("buildIdForHtml returns the same id for the same HTML twice", () => {
  assert.equal(buildIdForHtml(SAMPLE_HTML, SAMPLE_VERSION), buildIdForHtml(SAMPLE_HTML, SAMPLE_VERSION));
});

test("buildIdForHtml is idempotent for already-stamped HTML (normalizes back to placeholder)", () => {
  const id = buildIdForHtml(SAMPLE_HTML, SAMPLE_VERSION);
  const stamped = SAMPLE_HTML.replace(BUILD_ID_TOKEN, id);
  assert.notEqual(stamped, SAMPLE_HTML, "sanity: stamped html differs from placeholder html");
  assert.equal(buildIdForHtml(stamped, SAMPLE_VERSION), id);
});

test("buildIdForHtml returns different ids for different HTML", () => {
  const other = SAMPLE_HTML.replace('id="root"', 'id="main"');
  assert.notEqual(buildIdForHtml(SAMPLE_HTML, SAMPLE_VERSION), buildIdForHtml(other, SAMPLE_VERSION));
});

test("buildIdForHtml starts with the version prefix and is deterministic", () => {
  const id = buildIdForHtml(SAMPLE_HTML, SAMPLE_VERSION);
  assert.ok(id.startsWith(`${SAMPLE_VERSION}-`), `expected "${SAMPLE_VERSION}-" prefix, got ${id}`);
  assert.match(id, /^\d+\.\d+\.\d+-[0-9a-f]{12}$/, `expected 12-hex digest suffix, got ${id}`);
  assert.equal(buildIdForHtml(SAMPLE_HTML, SAMPLE_VERSION), id);
});
