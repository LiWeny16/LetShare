// Post-build: generate version.json sentinel file.
// The SW and client use this tiny file to detect new deployments.
// When version changes → SW forces cache refresh → client reloads.
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { injectBuildId, buildIdForHtml } = require('./build-id.cjs');

const docsDir = join(__dirname, '..', 'docs');
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const now = new Date().toISOString();

// Stamp the build id into the served HTML so the page can detect when it is
// stale and offer a non-blocking reload prompt.
try {
  const indexHtmlPath = join(docsDir, 'index.html');
  // Keep docs/index.html UTF-8 without BOM: strip any BOM on read, write utf8.
  const indexHtml = readFileSync(indexHtmlPath, 'utf8').replace(/^\uFEFF/, '');

  // Deterministic build id: version + short sha256 of the built HTML with any
  // existing build-id meta value normalized back to the placeholder. Same
  // build output => same id, so re-running the script is idempotent and
  // docs/index.html stays clean in git for unchanged builds.
  const buildId = buildIdForHtml(indexHtml, packageJson.version);

  const version = {
    version: packageJson.version,
    v: buildId,
    built: now,
  };

  writeFileSync(join(docsDir, 'version.json'), JSON.stringify(version));
  console.log(`[version] Generated version.json: ${buildId}`);

  const normalized = indexHtml.replace(
    /(<meta name="letshare-build" content=")[^"]*(")/, "$1__LETSHARE_BUILD_ID__$2"
  );
  writeFileSync(indexHtmlPath, injectBuildId(normalized, buildId), 'utf8');
  console.log(`[version] Stamped build ${buildId} into docs/index.html`);
} catch (err) {
  console.error(`[version] ERROR: failed to stamp build id into docs/index.html: ${err.message}`);
  process.exit(1);
}
