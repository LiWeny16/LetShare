import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const downloadSource = readFileSync(
  join(process.cwd(), "src", "components", "Download.tsx"),
  "utf8"
);

test("download-all zip uses a manageable letshare timestamp filename", () => {
  assert.doesNotMatch(downloadSource, /Received_\$\{Date\.now\(\)\}\.zip/);
  assert.match(downloadSource, /const zipFileName = `letshare_\$\{Date\.now\(\)\}\.zip`;/);
});

test("browser zip download is exposed as a user-clickable save link after packaging", () => {
  assert.doesNotMatch(downloadSource, /downloadFileInBrowser\(zipFile,\s*zipFileName\)/);
  assert.match(downloadSource, /pendingBrowserDownload/);
  assert.match(downloadSource, /component="a"/);
  assert.match(downloadSource, /download=\{pendingBrowserDownload\.fileName\}/);
});

test("web download UI explains Safari location and browser path limits", () => {
  assert.match(downloadSource, /Safari/);
  assert.match(downloadSource, /文件 App/);
  assert.match(downloadSource, /网页无法指定保存路径/);
});

test("send progress panel is only shown for an active outgoing transfer", () => {
  assert.match(
    downloadSource,
    /const showSendingProgress = progress !== null && realTimeColab\.hasActiveOutgoingFileTransfer\(\);/
  );
  assert.match(downloadSource, /showSendingProgress \|\|/);
  assert.match(downloadSource, /\{showSendingProgress && \(/);
  assert.doesNotMatch(downloadSource, /\{progress !== null && \(/);
});

test("download drawer has a centered floating height toggle", () => {
  assert.match(downloadSource, /KeyboardArrowDownIcon/);
  assert.match(downloadSource, /KeyboardArrowUpIcon/);
  assert.match(downloadSource, /const \[drawerExpanded, setDrawerExpanded\] = React\.useState\(false\);/);
  assert.doesNotMatch(downloadSource, /height:\s*drawerExpanded \? "90vh" : "auto"/);
  assert.match(downloadSource, /minHeight:\s*drawerExpanded \? "90vh" : 0/);
  assert.match(downloadSource, /maxHeight:\s*drawerExpanded \? "90vh" : 400/);
  assert.match(downloadSource, /min-height/);
  assert.match(downloadSource, /max-height/);
  assert.match(downloadSource, /left:\s*"50%"/);
  assert.match(downloadSource, /transform:\s*"translateX\(-50%\)"/);
  assert.match(downloadSource, /color:\s*"common\.black"/);
  assert.match(downloadSource, /drawerExpanded \? <KeyboardArrowUpIcon \/> : <KeyboardArrowDownIcon \/>/);
});

test("download drawer outside area passes clicks through to the backdrop", () => {
  assert.match(downloadSource, /<Backdrop[\s\S]*onClick=\{onClose\}/);
  assert.match(downloadSource, /pointerEvents:\s*"none"/);
  assert.match(downloadSource, /pointerEvents:\s*"auto"/);
});
