// Pre-build: remove old hashed chunks not referenced by the current HTML.
// Runs before `vite build` to keep docs/static/ lean and prevent SW precache
// from accumulating stale entries that may later 404.
//
// Strategy:
//   - Keep files referenced in index.html / landing.html
//   - For chunk groups that generate 1-per-build (index-*, pnpm-vendor-*,
//     landing-*, modulepreload-polyfill-*): keep only the referenced version
//   - For dynamic-import chunks (AblyConnectionProvider, etc.): keep ALL
//   - Delete orphaned .gz files

const { readFileSync, readdirSync, unlinkSync, existsSync } = require('fs');
const { join } = require('path');

const docsDir = join(__dirname, '..', 'docs');
const staticDir = join(docsDir, 'static');

// ── helpers ──────────────────────────────────────────────────────────

function readIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

/** Extract referenced static filenames from HTML */
function extractRefs(html) {
  const refs = new Set();
  const re = /(?:src|href)="\.\/static\/([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) refs.add(m[1]);
  const rootRe = /(?:src|href)="\.\/(static-[a-zA-Z0-9_-]+\.css)"/g;
  while ((m = rootRe.exec(html)) !== null) refs.add(m[1]);
  return refs;
}

/**
 * Extract the "prefix" from a hashed filename.
 *   prefix-HASH.ext  (e.g. "pnpm-vendor" + "hcBMNS7i" + "js")
 * Returns null if the filename doesn't match the hashed pattern.
 */
function extractPrefix(filename) {
  // Strip .gz suffix first if present
  const isGz = filename.endsWith('.gz');
  const base = isGz ? filename.slice(0, -3) : filename;
  // Match: NAME-HASH.ext  where HASH is alphanumeric (6+ chars) after the LAST dash
  const m = base.match(/^(.+)-([A-Za-z0-9_]{6,})\.([^.]+)$/);
  return m ? { prefix: m[1], hash: m[2], ext: m[3], isGz } : null;
}

// Single-version prefixes: each build produces exactly one file per prefix,
// so unreferenced versions are safe to delete.
const singleVersionPrefixes = [
  'index',
  'pnpm-vendor',
  'landing',
  'modulepreload-polyfill',
];

// ── main ─────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(staticDir)) {
    console.log('[cleanup] docs/static not found, skipping');
    return;
  }

  const indexHtml = readIfExists(join(docsDir, 'index.html'));
  const landingHtml = readIfExists(join(docsDir, 'landing.html'));
  const refs = new Set([...extractRefs(indexHtml), ...extractRefs(landingHtml)]);

  const staticFiles = readdirSync(staticDir);
  const rootCssFiles = readdirSync(docsDir).filter(
    f => /^static-[a-zA-Z0-9_-]+\.css(\.gz)?$/.test(f)
  );
  const allFiles = [...staticFiles, ...rootCssFiles];

  let removedCount = 0;

  // ── Delete unreferenced single-version chunks ──────────────────────
  for (const filename of allFiles) {
    const info = extractPrefix(filename);
    if (!info) continue;
    if (!singleVersionPrefixes.includes(info.prefix)) continue;
    if (refs.has(filename)) continue; // referenced → keep

    // Unreferenced → delete
    const dir = rootCssFiles.includes(filename) ? docsDir : staticDir;
    const filePath = join(dir, filename);
    try {
      unlinkSync(filePath);
      removedCount++;
    } catch (err) {
      console.warn(`[cleanup] Failed to remove ${filePath}:`, err.message);
    }
  }

  // ── Clean up orphaned .gz files ────────────────────────────────────
  const remaining = [
    ...readdirSync(staticDir),
    ...readdirSync(docsDir).filter(f => /^static-[a-zA-Z0-9_-]+\.css(\.gz)?$/.test(f)),
  ];
  for (const filename of remaining) {
    if (!filename.endsWith('.gz')) continue;
    const counterpart = filename.slice(0, -3); // remove .gz
    if (!remaining.includes(counterpart)) {
      const dir = rootCssFiles.includes(counterpart) || filename.match(/\.css\.gz$/) ? docsDir : staticDir;
      try {
        unlinkSync(join(dir, filename));
        removedCount++;
      } catch {}
    }
  }

  if (removedCount > 0) {
    console.log(`[cleanup] Removed ${removedCount} stale chunk(s), kept referenced + dynamic imports`);
  } else {
    console.log('[cleanup] No stale chunks to remove');
  }
}

main();
