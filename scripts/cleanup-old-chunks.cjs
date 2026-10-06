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
  // NOTE: Vite emits lazily-loaded chunks as template-literal dynamic imports
  // (`import(`./share-XXXX.js`)`) and lists them again in __vite__mapDeps.
  // Quote style therefore has to include the backtick: matching only " and '
  // silently missed every lazy chunk, which is exactly why share-*,
  // meeting-*, FileBlobStore-* and friends never entered the reachability set.
  const patterns = [
    /from\s*["'`]\.\/([^"'`]+)["'`]/g,
    /import\s*\(\s*["'`]\.\/([^"'`]+)["'`]\s*\)/g,
    /import\s*["'`]\.\/([^"'`]+)["'`]/g,
    // __vite__mapDeps dependency list: "./chunk-XXXX.js"
    /["'`]\.\/([A-Za-z0-9_.-]+\.js)["'`]/g,
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
//
// This list is a legacy safety belt. The reachability set computed above is
// already authoritative for EVERY hashed chunk, not just these prefixes:
// a chunk absent from `refs` is imported by nothing, so the browser can never
// request it. The whitelist was previously the only thing that got deleted,
// which let lazily-imported chunks (share-*, meeting-*, FileBlobStore-*,
// remoteAudioPipeline-*, ...) accumulate one build's worth of dead copies per
// release - 1108 orphans / 123 MB had built up by the time this was fixed.
// Worse, VitePWA globs docs/ to build the service-worker precache list, so
// every orphan was also pinned into sw.js, keeping the garbage alive.
const singleVersionPrefixes = [
  'index',
  'pnpm-vendor',
  'landing',
  'modulepreload-polyfill',
  'AblyConnectionProvider',
  'rolldown-runtime',
];

/**
 * A hashed build artifact: `<name>-<hash>.js` produced by Vite.
 * Only these are eligible for the general reachability sweep.
 *
 * Deliberately excluded:
 *   - hand-authored static assets (no hash) such as workletProcessor.js,
 *     which are referenced from code in ways the regex extractor may miss;
 *   - anything the entry HTML does not own.
 */
function isHashedBuildChunk(filename) {
  const base = stripGzipSuffix(filename);
  if (!base.endsWith('.js')) return false;
  // Vite hashes are 8+ chars of [A-Za-z0-9_-] preceded by '-'.
  return /-[A-Za-z0-9_-]{8,}\.js$/.test(base);
}

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
  const removed = [];
  const kept = [];

  // ── Delete unreferenced single-version chunks ──────────────────────
  for (const filename of allFiles) {
    const isLegacyPrefix = singleVersionPrefixes.some(prefix =>
      isSingleVersionChunk(filename, prefix)
    );
    // General sweep: any hashed Vite chunk that nothing reaches is dead,
    // regardless of its name prefix. `refs` holds the transitive closure from
    // index.html/landing.html, so a miss means no chunk imports it.
    const isDeadHashedChunk = isHashedBuildChunk(filename) && !refs.has(stripGzipSuffix(filename));
    if (!isLegacyPrefix && !isDeadHashedChunk && !isRootEntryCss(filename)) continue;

    const referenceName = stripGzipSuffix(filename);
    if (refs.has(referenceName)) continue; // referenced → keep

    // Unreferenced → delete
    const dir = rootCssFiles.includes(filename) ? docsDir : staticDir;
    const filePath = join(dir, filename);
    try {
      unlinkSync(filePath);
      removed.push(filename);
      removedCount++;
    } catch (err) {
      console.warn(`[cleanup] Failed to remove ${filePath}:`, err.message);
    }
  }

  // Safety net: the reachability walk must not have been starved by an
  // unparsable reference form. If anything we just deleted is still named by a
  // SURVIVING file, a regex missed it - restore from git rather than ship a
  // site with broken lazy imports.
  const survivors = new Set(readdirSync(staticDir).map(stripGzipSuffix));
  const wronglyDeleted = [];
  for (const filename of removed) {
    const base = stripGzipSuffix(filename);
    if (!base.endsWith('.js')) continue;
    for (const other of survivors) {
      if (!other.endsWith('.js')) continue;
      const body = readIfExists(join(staticDir, other));
      if (body.includes(base)) { wronglyDeleted.push(base); break; }
    }
  }
  if (wronglyDeleted.length > 0) {
    console.error(`[cleanup] ABORT-CHECK: ${wronglyDeleted.length} deleted chunk(s) are still referenced by surviving files:`);
    console.error(`[cleanup]   ${wronglyDeleted.slice(0, 8).join(', ')}${wronglyDeleted.length > 8 ? ' ...' : ''}`);
    console.error('[cleanup] The reachability patterns missed a reference form. Restoring them.');
    for (const base of wronglyDeleted) {
      try {
        execFileSync('git', ['checkout', 'HEAD', '--', `docs/static/${base}`], { cwd: repoRoot, stdio: 'ignore' });
        removedCount--;
      } catch (err) {
        console.error(`[cleanup] Failed to restore ${base}:`, err.message);
      }
    }
    console.error('[cleanup] Fix extractRelativeJsRefs before relying on this sweep.');
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
