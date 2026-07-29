import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const serverSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "connection", "ServerFileTransfer.ts"),
  "utf8"
);
const colabLibSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "connection", "colabLib.ts"),
  "utf8"
);
const downloadSource = readFileSync(
  join(repoRoot, "src", "components", "Download.tsx"),
  "utf8"
);
const shareSource = readFileSync(
  join(repoRoot, "src", "pages", "share.tsx"),
  "utf8"
);
const translationSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "i18n", "translation.ts"),
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
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }

  assert.fail(`method ${methodName} body should close`);
}

test("server relay browser-cache overflow queues direct-to-disk instead of rejecting when supported", () => {
  const body = extractMethodBody(serverSource, "private async handleTransferRequest");
  const overflowStart = body.indexOf("if (!cacheGuard.allowed)");
  const sessionStart = body.indexOf("const session: ReceiveSession", overflowStart);
  assert.notEqual(overflowStart, -1);
  assert.notEqual(sessionStart, -1);

  const overflowBranch = body.slice(overflowStart, sessionStart);
  assert.match(overflowBranch, /!this\.canUseDirectFileSave\(\)/);
  assert.match(overflowBranch, /this\.rejectIncomingRequest\(request,\s*fullReason\)/);
  assert.match(body, /storageMode:\s*cacheGuard\.allowed \? "browser-cache" : "direct-to-disk"/);
  assert.match(
    body,
    /if \(session\.storageMode === "direct-to-disk"\) \{[\s\S]*this\.queueDirectDiskReceive\(session,\s*session\.directSaveReason\)/
  );
});

test("server relay direct-to-disk waits for user picker before accepting transfer", () => {
  const acceptPendingBody = extractMethodBody(serverSource, "public async acceptPendingDirectDiskReceive");
  assert.match(acceptPendingBody, /const showSaveFilePicker = this\.getShowSaveFilePicker\(\)/);
  assert.match(acceptPendingBody, /new DirectFileWriteSink\(/);
  assert.match(acceptPendingBody, /this\.acceptTransfer\(request\.transferId,\s*request\.peerId\)/);

  const acceptBody = extractMethodBody(serverSource, "private acceptTransfer");
  assert.match(acceptBody, /session\.storageMode === "direct-to-disk"/);
  assert.match(acceptBody, /!session\.directSink/);
});

test("server relay direct-to-disk writes chunks to the disk sink and avoids browser File assembly", () => {
  const writeBody = extractMethodBody(serverSource, "private async writeChunkToSession");
  assert.match(writeBody, /await session\.directSink\.writeChunk\(chunkIndex,\s*bytes\)/);
  assert.match(writeBody, /this\.maybeSendReceiverAck\(session,\s*chunkIndex\)/);

  const finalizeBody = extractMethodBody(serverSource, "private async finalizeReceivedFile");
  const directStart = finalizeBody.indexOf('session.storageMode === "direct-to-disk"');
  const directEnd = finalizeBody.indexOf("} else {", directStart);
  assert.notEqual(directStart, -1);
  assert.notEqual(directEnd, -1);

  const directBranch = finalizeBody.slice(directStart, directEnd);
  assert.match(directBranch, /await session\.directSink\.close\(\)/);
  assert.match(directBranch, /this\.onFileSavedToDiskCallback\?\.\(session\.fileName,\s*session\.fileSize,\s*session\.fromUserId\)/);
  assert.doesNotMatch(directBranch, /this\.onFileReceivedCallback/);
  assert.doesNotMatch(directBranch, /createCompletedTransferFile/);
  assert.doesNotMatch(directBranch, /new File/);
});

test("server relay direct-to-disk completion is bridged to shared UI list and chat event", () => {
  assert.match(colabLibSource, /setFileSavedToDiskCallback/);
  assert.match(colabLibSource, /this\.directSavedFiles\.set\(fullKey/);
  assert.match(colabLibSource, /this\.emitter\.emit\('file-saved-to-disk'/);
  assert.match(colabLibSource, /export type DirectSaveRequest = P2PDirectSaveRequest \| ServerDirectSaveRequest/);
});

test("download direct-save button dispatches by transport-specific transfer id", () => {
  assert.match(downloadSource, /request\.transport === "server" \? request\.transferId : request\.peerId/);
  assert.match(downloadSource, /request\.transport,\s*\)/);
});

test("direct-save pending state is read without mutating render-visible state", () => {
  const getterBody = extractMethodBody(colabLibSource, "public getPendingDirectSaveRequest");
  assert.doesNotMatch(getterBody, /this\.pendingDirectSaveRequest\s*=/);
  assert.match(getterBody, /this\.pendingDirectSaveRequests\.values\(\)\.next\(\)\.value/);
  assert.match(getterBody, /this\.serverFileTransfer\?\.getPendingDirectSaveRequest\(\)/);

  assert.match(shareSource, /pendingDirectSaveRequest:\s*realTimeColab\.getPendingDirectSaveRequest\(\)/);
  assert.doesNotMatch(shareSource, /pendingDirectSaveRequest:\s*realTimeColab\.pendingDirectSaveRequest/);
});

test("server relay pending direct-save requests prevent background lifecycle disconnect", () => {
  const body = extractMethodBody(colabLibSource, "private hasPendingDirectSaveRequest");
  assert.match(body, /this\.pendingDirectSaveRequests\.size > 0/);
  assert.match(body, /this\.serverFileTransfer\?\.getPendingDirectSaveRequest\(\) !== null/);
});

test("direct-to-disk user-facing i18n keys exist in every configured locale", () => {
  for (const locale of ["sharedMalayTranslation", "en", "zh"]) {
    const localeStart = translationSource.indexOf(locale === "sharedMalayTranslation" ? "const sharedMalayTranslation" : `${locale}: {`);
    assert.notEqual(localeStart, -1, `${locale} locale should exist`);
    const localeEnd = locale === "sharedMalayTranslation"
      ? translationSource.indexOf("export const resources", localeStart)
      : translationSource.indexOf(locale === "en" ? "    zh: {" : "    ms: sharedMalayTranslation", localeStart);
    assert.notEqual(localeEnd, -1, `${locale} locale should have an end marker`);
    const block = translationSource.slice(localeStart, localeEnd);

    for (const key of [
      "directSavedNoBrowserHistory",
      "fileSavedToDisk",
      "fileSavedToDiskNoHistory",
      "directSaveNoBrowserHistory",
      "saveToDisk",
      "savedToDiskFiles",
    ]) {
      assert.match(block, new RegExp(`${key}:`), `${locale} should define ${key}`);
    }
  }
});
