// Pre-build: remove old hashed chunks not referenced by the current HTML.
// Runs before `vite build` to keep docs/static/ lean and prevent SW precache
// from accumulating stale entries that may later 404.
//
// Strategy:
//   - Keep files referenced in index.html / landing.html
//   - Keep JS chunks transitively referenced from those entry files
//   - For generated chunk groups (index-*, pnpm-vendor-*, landing-*,
//     modulepreload-polyfill-*, AblyConnectionProvider-*): delete versions that
//     are not reachable from the current entry files
//   - For generated root CSS (static-*.index.css, static-*.landing.css): delete
//     versions that are not referenced by the current HTML
//   - Delete orphaned .gz files

const { execFileSync } = require('child_process');
const { readFileSync, readdirSync, unlinkSync, existsSync } = require('fs');
const { join } = require('path');

const repoRoot = join(__dirname, '..');
const docsDir = join(repoRoot, 'docs');
const staticDir = join(docsDir, 'static');

// ── helpers ──────────────────────────────────────────────────────────

function readIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function readGitBlobIfExists(repoPath) {
  try {
    return execFileSync('git', ['show', `HEAD:${repoPath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
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

function stripGzipSuffix(filename) {
  return filename.endsWith('.gz') ? filename.slice(0, -3) : filename;
}

function isSingleVersionChunk(filename, prefix) {
  const base = stripGzipSuffix(filename);
  return base.startsWith(`${prefix}-`) && base.endsWith('.js');
}

function isRootEntryCss(filename) {
  const base = stripGzipSuffix(filename);
  return /^static-[a-zA-Z0-9_-]+\.(index|landing)\.css$/.test(base);
}

function extractRelativeJsRefs(js) {
  const refs = new Set();
  const patterns = [
    /from\s*["']\.\/([^"']+)["']/g,
    /import\s*\(\s*["']\.\/([^"']+)["']\s*\)/g,
    /import\s*["']\.\/([^"']+)["']/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(js)) !== null) refs.add(m[1]);
  }
  return refs;
}

function addTransitiveJsRefs(staticFiles, refs) {
  const available = new Set(staticFiles.map(stripGzipSuffix));
  const uniqueJsFiles = [...available].filter(f => f.endsWith('.js'));
  let changed = true;

  while (changed) {
    changed = false;
    for (const filename of uniqueJsFiles) {
      if (!refs.has(filename)) continue;

      const js = readIfExists(join(staticDir, filename));
      for (const dep of extractRelativeJsRefs(js)) {
        if (available.has(dep) && !refs.has(dep)) {
          refs.add(dep);
          changed = true;
        }
      }
    }
  }
}

// Single-version prefixes: each build produces exactly one file per prefix,
// so unreferenced versions are safe to delete.
const singleVersionPrefixes = [
  'index',
  'pnpm-vendor',
  'landing',
  'modulepreload-polyfill',
  'AblyConnectionProvider',
];

// ── main ─────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(staticDir)) {
    console.log('[cleanup] docs/static not found, skipping');
    return;
  }

  const indexHtml = readIfExists(join(docsDir, 'index.html'));
  const landingHtml = readIfExists(join(docsDir, 'landing.html'));
  const previousIndexHtml = readGitBlobIfExists('docs/index.html');
  const previousLandingHtml = readGitBlobIfExists('docs/landing.html');
  const refs = new Set([
    ...extractRefs(indexHtml),
    ...extractRefs(landingHtml),
    ...extractRefs(previousIndexHtml),
    ...extractRefs(previousLandingHtml),
  ]);

  const staticFiles = readdirSync(staticDir);
  const rootCssFiles = readdirSync(docsDir).filter(
    f => /^static-[a-zA-Z0-9_-]+\.css(\.gz)?$/.test(f)
  );
  const allFiles = [...staticFiles, ...rootCssFiles];
  addTransitiveJsRefs(staticFiles, refs);

  let removedCount = 0;

  // ── Delete unreferenced single-version chunks ──────────────────────
  for (const filename of allFiles) {
    const matchesSingleVersion = singleVersionPrefixes.some(prefix =>
      isSingleVersionChunk(filename, prefix)
    ) || isRootEntryCss(filename);
    if (!matchesSingleVersion) continue;

    const referenceName = stripGzipSuffix(filename);
    if (refs.has(referenceName)) continue; // referenced → keep

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
    console.log(`[cleanup] Removed ${removedCount} stale chunk(s), kept referenced assets`);
  } else {
    console.log('[cleanup] No stale chunks to remove');
  }
}

main();
