const fs = require("node:fs");
const path = require("node:path");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "docs"));
const manifestPath = path.join(outDir, ".vite", "manifest.json");

function fail(message) {
  console.error(`Boot chunk check failed: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(manifestPath)) {
  console.error(`Missing ${manifestPath}. Build with Vite's --manifest option first.`);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const editorChunkPattern = /(?:^|[\\/])[^\\/]*(?:excalidraw|mermaid)[^\\/]*\.js$/i;

function staticImportClosure(entryKey) {
  if (!manifest[entryKey]) {
    throw new Error(`Manifest entry not found: ${entryKey}`);
  }

  const visited = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;

    const chunk = manifest[key];
    if (!chunk) throw new Error(`Static import missing from manifest: ${key}`);

    visited.add(key);
    for (const importedKey of chunk.imports || []) visit(importedKey);
  };

  visit(entryKey);
  return visited;
}

function reportGraph(label, entryKey, byteBudget) {
  const keys = staticImportClosure(entryKey);
  const files = new Set();
  const editorChunks = [];

  for (const key of keys) {
    const file = manifest[key].file;
    if (file && file.endsWith(".js")) {
      files.add(file);
      if (editorChunkPattern.test(file)) editorChunks.push(file);
    }
  }

  if (editorChunks.length) {
    fail(`${label} statically imports editor-named chunks:\n${editorChunks.map((file) => `  ${file}`).join("\n")}`);
    return;
  }

  let bytes = 0;
  for (const file of files) {
    const filePath = path.resolve(outDir, file);
    if (!fs.existsSync(filePath)) {
      fail(`${label} references missing build output: ${file}`);
      return;
    }
    bytes += fs.statSync(filePath).size;
  }

  if (bytes > byteBudget) {
    fail(`${label} static graph is ${bytes} bytes; budget is ${byteBudget} bytes.`);
    return;
  }

  console.log(`${label}: ${files.size} JS files, ${bytes}/${byteBudget} byte budget; no editor-named chunks in static imports.`);
  return { keys, files };
}

const indexGraph = reportGraph("index", "index.html", 512 * 1024);
const shareGraph = reportGraph("Share", "src/pages/share.tsx", 2 * 1024 * 1024);
const indexEntry = manifest["index.html"];

if (!indexEntry.dynamicImports?.includes("src/pages/share.tsx")) {
  fail("index no longer reaches Share through its dynamic import boundary.");
}

if (indexGraph) {
  const htmlPath = path.join(outDir, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  if (!html.includes(indexEntry.file)) {
    fail(`index.html does not reference its manifest entry file: ${indexEntry.file}`);
  }

  const modulePreloads = [...html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi)]
    .map(([tag]) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1])
    .filter(Boolean)
    .map((url) => decodeURIComponent(url.split(/[?#]/, 1)[0]).replace(/^\.\//, "").replace(/^\//, ""));

  for (const preload of modulePreloads) {
    if (!indexGraph.files.has(preload)) {
      fail(`index.html eagerly preloads a file outside the index static graph: ${preload}`);
    }
  }
}

if (shareGraph) {
  console.log(`Share: ${shareGraph.keys.size} manifest modules checked across static import edges.`);
}

if (process.exitCode) process.exit(process.exitCode);
