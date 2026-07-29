import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const colabLibSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "connection", "colabLib.ts"),
  "utf8"
);

function extractMethodBody(source: string, methodName: string): string {
  const methodIndex = source.indexOf(methodName);
  assert.notEqual(methodIndex, -1, `method ${methodName} should exist`);

  const bodyStart = source.indexOf("{", methodIndex);
  assert.notEqual(bodyStart, -1, `method ${methodName} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }

  assert.fail(`method ${methodName} body should close`);
}

test("oversized P2P metadata queues direct-to-disk receive instead of aborting immediately", () => {
  const fileMetaStart = colabLibSource.indexOf('case "file-meta"');
  const oversizedStart = colabLibSource.indexOf("normalizedMeta.fileSize > receiveLimit", fileMetaStart);
  const oversizedEnd = colabLibSource.indexOf("const cacheGuard", oversizedStart);
  assert.notEqual(fileMetaStart, -1);
  assert.notEqual(oversizedStart, -1);
  assert.notEqual(oversizedEnd, -1);

  const branch = colabLibSource.slice(oversizedStart, oversizedEnd);
  assert.match(branch, /this\.queueDirectDiskReceive\(id,\s*channel,\s*normalizedMeta\)/);
  assert.doesNotMatch(branch, /type:\s*"abort"/);
});

test("P2P sender waits for receiver file-ready before starting binary workers", () => {
  const body = extractMethodBody(colabLibSource, "public async sendFileToUser");
  const metaSendIndex = body.indexOf("channel.send(JSON.stringify(metaMessage))");
  const readyWaitIndex = body.indexOf("this.P2P_READY_TIMEOUT_MS", metaSendIndex);
  const workerStartIndex = body.indexOf("Promise.all(Array.from", readyWaitIndex);

  assert.ok(metaSendIndex >= 0, "sender should send metadata first");
  assert.ok(readyWaitIndex > metaSendIndex, "sender should wait for file-ready after metadata");
  assert.ok(workerStartIndex > readyWaitIndex, "workers should start only after receiver ready");
  assert.match(colabLibSource, /case "file-ready":[\s\S]*this\.p2pAckTracker\.acknowledge\(message\.transferId\)/);
});

test("direct-to-disk completion avoids creating a retained browser File", () => {
  const completionStart = colabLibSource.indexOf("const completedTransferId = fileInfo.transferId");
  const directBranchStart = colabLibSource.indexOf(
    'if (fileInfo.storageMode === "direct-to-disk")',
    completionStart
  );
  const directBranchEnd = colabLibSource.indexOf("if (!fileInfo.receiveBuffer)", directBranchStart);
  assert.notEqual(completionStart, -1);
  assert.notEqual(directBranchStart, -1);
  assert.notEqual(directBranchEnd, -1);

  const branch = colabLibSource.slice(directBranchStart, directBranchEnd);
  assert.match(branch, /fileInfo\.directSink\.close\(\)/);
  assert.match(branch, /this\.directSavedFiles\.set\(/);
  assert.match(branch, /this\.emitter\.emit\('file-saved-to-disk'/);
  assert.match(branch, /type:\s*"file-complete"/);
  assert.doesNotMatch(branch, /createCompletedTransferFile/);
  assert.doesNotMatch(branch, /this\.receivedFiles\.set/);
  assert.doesNotMatch(branch, /maybeAutoUnzipReceivedFile/);
});

test("P2P browser cache overflow routes to direct-to-disk instead of rejecting when supported", () => {
  const fileMetaStart = colabLibSource.indexOf('case "file-meta"');
  const cacheGuardStart = colabLibSource.indexOf("const cacheGuard = canRetainReceivedFiles", fileMetaStart);
  const cacheOverflowStart = colabLibSource.indexOf("if (!cacheGuard.allowed)", cacheGuardStart);
  const cacheOverflowEnd = colabLibSource.indexOf("// 初始化新的接收状态", cacheOverflowStart);
  assert.notEqual(cacheGuardStart, -1);
  assert.notEqual(cacheOverflowStart, -1);
  assert.notEqual(cacheOverflowEnd, -1);

  const branch = colabLibSource.slice(cacheOverflowStart, cacheOverflowEnd);
  assert.match(branch, /this\.queueDirectDiskReceive\(id,\s*channel,\s*normalizedMeta,\s*cacheLimitMessage\)/);
  assert.doesNotMatch(branch, /type:\s*"abort"/);
});

test("pending direct-to-disk save request prevents background lifecycle cleanup", () => {
  const activeCountBody = extractMethodBody(colabLibSource, "private getActiveFileTransferCount");
  assert.match(activeCountBody, /this\.pendingDirectSaveRequests\.size/);

  const watcherBody = extractMethodBody(colabLibSource, "private setupVisibilityWatcher");
  const pendingGuardIndex = watcherBody.indexOf("this.hasPendingDirectSaveRequest()");
  const activeCountIndex = watcherBody.indexOf("const activeTransferCount = this.getActiveFileTransferCount()");
  const disconnectIndex = watcherBody.indexOf("() => this.disconnect()", activeCountIndex);

  assert.ok(pendingGuardIndex >= 0, "visibility watcher should check pending direct saves");
  assert.ok(
    pendingGuardIndex < activeCountIndex,
    "pending direct save should be handled before lifecycle transfer cleanup"
  );
  assert.ok(
    pendingGuardIndex < disconnectIndex,
    "pending direct save should be handled before background disconnect"
  );
});
