// Post-build: generate version.json sentinel file.
// The SW and client use this tiny file to detect new deployments.
// When version changes → SW forces cache refresh → client reloads.
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const docsDir = join(__dirname, '..', 'docs');
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const now = new Date().toISOString();

// Build ID: timestamp + short random to handle same-second rebuilds
const buildId = `${now.slice(0, 19)}Z-${Math.random().toString(36).slice(2, 7)}`;

const version = {
  version: packageJson.version,
  v: buildId,
  built: now,
};

writeFileSync(join(docsDir, 'version.json'), JSON.stringify(version));
console.log(`[version] Generated version.json: ${buildId}`);
