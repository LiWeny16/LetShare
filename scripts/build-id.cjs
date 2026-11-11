const crypto = require("crypto");

// Shared build-id token + HTML injection used by post-build version stamping.
//
// The placeholder lives in index.html:
//   <meta name="letshare-build" content="__LETSHARE_BUILD_ID__">
// generate-version-json.cjs replaces only that occurrence with the build id.
// The runtime treats any value starting with "__" as "no build" (dev/legacy),
// so other occurrences of the token may remain in the document safely.
const BUILD_ID_TOKEN = "__LETSHARE_BUILD_ID__";

// Matches exactly the letshare-build meta placeholder; no /g flag → only the
// first (that) occurrence is replaced.
const BUILD_META_RE = /(<meta name="letshare-build" content=")__LETSHARE_BUILD_ID__(")/;

/**
 * Replace the build-id placeholder inside the letshare-build meta tag.
 * Other occurrences of the token are left untouched.
 * @param {string} html document content (utf8)
 * @param {string} buildId build id to inject
 * @returns {string} new html content
 * @throws {Error} if the meta placeholder is missing
 */
function injectBuildId(html, buildId) {
  if (typeof html !== "string" || typeof buildId !== "string" || !buildId) {
    throw new Error("injectBuildId: html and a non-empty string buildId are required");
  }
  if (!BUILD_META_RE.test(html)) {
    throw new Error(
      'Missing build meta placeholder <meta name="letshare-build" content="__LETSHARE_BUILD_ID__"> ' +
        "in the HTML; refusing to ship an unversioned build."
    );
  }
  // Function replacement so a "$"-containing buildId can never be mangled.
  return html.replace(BUILD_META_RE, function (_match, open, close) {
    return open + buildId + close;
  });
}

/**
 * Deterministic build id: package version + short sha256 of the built HTML
 * with any existing build-id meta value normalized back to the placeholder.
 * Same build output => same id; changed source/chunks => different id.
 * @param {string} html document content (utf8)
 * @param {string} version package version
 * @returns {string} build id of the form "<version>-<12 hex>"
 */
function buildIdForHtml(html, version) {
  const normalized = String(html).replace(
    /(<meta name="letshare-build" content=")[^"]*(")/,
    "$1__LETSHARE_BUILD_ID__$2"
  );
  const digest = crypto.createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 12);
  return `${version}-${digest}`;
}

module.exports = { BUILD_ID_TOKEN, injectBuildId, buildIdForHtml };
