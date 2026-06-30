// Post-build: rename dot-prefixed files for GitHub Pages compatibility.
// GitHub Pages returns 404 on files starting with "." (hidden files).
const { readdirSync, renameSync, readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const docsDir = join(__dirname, '..', 'docs');
const staticDir = join(docsDir, 'static');
const rootTextFiles = ['index.html', 'landing.html', 'sw.js'].map(f => join(docsDir, f));

if (!existsSync(staticDir)) {
  console.log('docs/static not found, skipping dotfile fix');
  process.exit(0);
}

function getStaticFiles() {
  return readdirSync(staticDir);
}

const dotFiles = readdirSync(staticDir).filter(f => f.startsWith('.'));
const renamedFiles = new Map();

for (const oldName of dotFiles) {
  const newName = oldName.slice(1); // remove leading dot
  const oldPath = join(staticDir, oldName);
  const newPath = join(staticDir, newName);

  if (existsSync(newPath)) {
    console.log(`target already exists, keeping: ${newName}`);
  } else {
    renameSync(oldPath, newPath);
    console.log(`renamed: ${oldName} -> ${newName}`);
  }

  renamedFiles.set(oldName, newName);
}

function getTextFiles() {
  const staticJsFiles = getStaticFiles()
    .filter(f => f.endsWith('.js'))
    .map(f => join(staticDir, f));

  return [...rootTextFiles, ...staticJsFiles].filter(existsSync);
}

function getReplacementPairs() {
  const pairs = new Map(renamedFiles);

  for (const fileName of getStaticFiles()) {
    if (!fileName.startsWith('.')) {
      pairs.set(`.${fileName}`, fileName);
    }
  }

  return [...pairs.entries()];
}

function rewriteLegacyDotReferences() {
  const replacementPairs = getReplacementPairs();

  for (const textPath of getTextFiles()) {
    const original = readFileSync(textPath, 'utf8');
    let updated = original;

    for (const [oldName, newName] of replacementPairs) {
      if (updated.includes(oldName)) {
        updated = updated.replaceAll(oldName, newName);
      }
    }

    if (updated !== original) {
      writeFileSync(textPath, updated);
      console.log(`fixed legacy dot-prefixed references in ${textPath}`);
    }
  }
}

rewriteLegacyDotReferences();

if (dotFiles.length === 0) {
  console.log('No dot-prefixed files to rename; checked legacy references');
}
