// Post-build: rename dot-prefixed files for GitHub Pages compatibility.
// GitHub Pages returns 404 on files starting with "." (hidden files).
const { readdirSync, renameSync, readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const staticDir = join(__dirname, '..', 'docs', 'static');
const htmlFiles = ['index.html', 'landing.html'].map(f => join(__dirname, '..', 'docs', f));

if (!existsSync(staticDir)) {
  console.log('docs/static not found, skipping dotfile fix');
  process.exit(0);
}

const dotFiles = readdirSync(staticDir).filter(f => f.startsWith('.'));
if (dotFiles.length === 0) {
  console.log('No dot-prefixed files to fix');
  process.exit(0);
}

for (const oldName of dotFiles) {
  const newName = oldName.slice(1); // remove leading dot
  renameSync(join(staticDir, oldName), join(staticDir, newName));
  console.log(`renamed: ${oldName} -> ${newName}`);

  // Fix references in HTML
  for (const htmlPath of htmlFiles) {
    if (existsSync(htmlPath)) {
      let content = readFileSync(htmlPath, 'utf8');
      if (content.includes(oldName)) {
        content = content.replaceAll(oldName, newName);
        writeFileSync(htmlPath, content);
        console.log(`  fixed in ${htmlPath}`);
      }
    }
  }

  // Fix references in JS chunks
  const jsFiles = readdirSync(staticDir).filter(f => f.endsWith('.js'));
  for (const jsFile of jsFiles) {
    const jsPath = join(staticDir, jsFile);
    let content = readFileSync(jsPath, 'utf8');
    if (content.includes(oldName)) {
      content = content.replaceAll(oldName, newName);
      writeFileSync(jsPath, content);
      console.log(`  fixed in ${jsFile}`);
    }
  }
}
