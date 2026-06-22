import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const colabLibSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "connection", "colabLib.ts"),
  "utf8"
);
const serverFileTransferSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "connection", "ServerFileTransfer.ts"),
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

function assertBranchPublishesReasonStatus(
  source: string,
  marker: string,
  statusCallPattern: RegExp,
  endToken = "break;"
): void {
  const branchStart = source.indexOf(marker);
  assert.notEqual(branchStart, -1, `branch ${marker} should exist`);

  const branchEnd = source.indexOf(endToken, branchStart);
  assert.notEqual(branchEnd, -1, `branch ${marker} should end with ${endToken}`);

  const branch = source.slice(branchStart, branchEnd);
  assert.match(branch, statusCallPattern);
}

test("P2P receive aborts publish a persistent retry status", () => {
  const body = extractMethodBody(colabLibSource, "private abortP2PReceive");

  assert.match(body, /this\.setFileTransferStatus\(\s*reason,\s*"error"/);
  assert.match(body, /autoClearMs:\s*10_000/);
});

test("unknown P2P binary chunks publish a persistent retry status", () => {
  const unknownBinaryStart = colabLibSource.indexOf("if (!fileInfo)");
  assert.notEqual(unknownBinaryStart, -1, "unknown binary branch should exist");

  const unknownBinaryEnd = colabLibSource.indexOf("return;", unknownBinaryStart);
  assert.notEqual(unknownBinaryEnd, -1, "unknown binary branch should return");

  const branch = colabLibSource.slice(unknownBinaryStart, unknownBinaryEnd);

  assert.match(branch, /this\.setFileTransferStatus\(\s*reason,\s*"error"/);
  assert.match(branch, /autoClearMs:\s*10_000/);
});

test("server relay binary chunks without a receive session publish a persistent retry status", () => {
  const body = extractMethodBody(serverFileTransferSource, "public handleBinaryData");
  const branchStart = body.indexOf("收到文件分片但接收会话不存在");
  assert.notEqual(branchStart, -1, "server missing-session branch should exist");

  const branchEnd = body.indexOf("return;", branchStart);
  assert.notEqual(branchEnd, -1, "server missing-session branch should return");

  const branch = body.slice(branchStart, branchEnd);

  assert.match(branch, /this\.setTransferStatus\(\s*reason,\s*"error"/);
});

test("server relay connection loss publishes a persistent retry status", () => {
  const body = extractMethodBody(serverFileTransferSource, "public handleConnectionLost");

  assert.match(body, /this\.setTransferStatus\(\s*reason,\s*"error"/);
});

test("malformed server relay messages that stop a sender publish a persistent retry status", () => {
  const body = extractMethodBody(serverFileTransferSource, "private handleMalformedTransferMessage");
  const branchStart = body.indexOf("sendingSession.status = \"error\"");
  assert.notEqual(branchStart, -1, "malformed message sender-stop branch should exist");

  const branch = body.slice(branchStart);

  assert.match(branch, /this\.setTransferStatus\(\s*reason,\s*"error"/);
});

test("P2P completion post processing does not keep the receive buffer alive", () => {
  const completionStart = colabLibSource.indexOf("const completedTransferId = fileInfo.transferId");
  assert.notEqual(completionStart, -1, "P2P completion branch should save transfer id before post processing");

  const completionEnd = colabLibSource.indexOf("alertUseMUI(t(\"alert.fileReceived\"", completionStart);
  assert.notEqual(completionEnd, -1, "P2P completion branch should alert after post processing starts");

  const branch = colabLibSource.slice(completionStart, completionEnd);
  const deleteIndex = branch.indexOf("this.receivingFiles.delete(id);");
  const postProcessIndex = branch.indexOf("confirmCompletionBeforePostProcessing");

  assert.notEqual(deleteIndex, -1, "P2P receive session should be removed after file creation");
  assert.notEqual(postProcessIndex, -1, "P2P completion should still confirm before post processing");
  assert.ok(
    deleteIndex < postProcessIndex,
    "P2P receive session should be removed before async post processing captures memory"
  );
  assert.match(branch, /const completedTransferId = fileInfo\.transferId/);
  assert.doesNotMatch(branch, /fileInfo\.transferId && channel\.readyState/);
});

test("P2P receive completion clears stale receiving progress and status", () => {
  const completionStart = colabLibSource.indexOf("const completedTransferId = fileInfo.transferId");
  assert.notEqual(completionStart, -1, "P2P completion branch should exist");

  const completionEnd = colabLibSource.indexOf("alertUseMUI(t(\"alert.fileReceived\"", completionStart);
  assert.notEqual(completionEnd, -1, "P2P completion branch should alert after cleanup");

  const branch = colabLibSource.slice(completionStart, completionEnd);

  assert.match(branch, /this\.setFileTransferProgress\(null\)/);
  assert.match(branch, /this\.setFileTransferStatus\(\s*"文件接收完成",\s*"success"[\s\S]*autoClearMs:\s*CONFIG\.TRANSFER_COMPLETE_DELAY/);
});

test("P2P channel close publishes a persistent retry status for active transfers", () => {
  const closeStart = colabLibSource.indexOf("channel.onclose = () =>");
  assert.notEqual(closeStart, -1, "P2P channel close handler should exist");

  const closeEnd = colabLibSource.indexOf("channel.onerror = () =>", closeStart);
  assert.notEqual(closeEnd, -1, "P2P channel close handler should end before error handler");

  const body = colabLibSource.slice(closeStart, closeEnd);

  assert.match(body, /this\.setFileTransferStatus\(\s*"P2P 连接已断开，当前文件传输已停止，请重试",\s*"error"/);
  assert.match(body, /autoClearMs:\s*10_000/);
});

test("P2P channel error cleanup publishes a persistent retry status for active transfers", () => {
  const body = extractMethodBody(colabLibSource, "private cleanupDataChannel");

  assert.match(body, /this\.setFileTransferStatus\(\s*"P2P 连接异常，当前文件传输已停止，请重试",\s*"error"/);
  assert.match(body, /autoClearMs:\s*10_000/);
});

test("page lifecycle transfer stop publishes a persistent retry status", () => {
  const body = extractMethodBody(colabLibSource, "private stopActiveFileTransfersForLifecycle");

  assert.match(body, /this\.setFileTransferStatus\(\s*reason,\s*"warning"/);
  assert.match(body, /autoClearMs:\s*10_000/);
});

test("server relay unavailable and request timeout states remain visible", () => {
  const sendBody = extractMethodBody(serverFileTransferSource, "public async sendFileViaServer");
  const timeoutBody = extractMethodBody(serverFileTransferSource, "private scheduleRequestTimeout");

  assert.match(sendBody, /this\.setTransferStatus\(\s*message,\s*"warning"/);
  assert.match(timeoutBody, /this\.setTransferStatus\(\s*"对方未响应文件传输请求，请重试",\s*"warning"/);
});

test("P2P file metadata rejection reasons remain visible", () => {
  const fileMetaStart = colabLibSource.indexOf('case "file-meta"');
  const fileMetaEnd = colabLibSource.indexOf("this.receivingFiles.set(id", fileMetaStart);
  assert.notEqual(fileMetaStart, -1, "P2P file-meta branch should exist");
  assert.notEqual(fileMetaEnd, -1, "P2P file-meta rejection section should end before receive setup");

  const branch = colabLibSource.slice(fileMetaStart, fileMetaEnd);
  const statusPattern = /this\.setFileTransferStatus\(\s*reason,\s*"(?:error|warning)"[\s\S]*autoClearMs:\s*10_000/;

  assertBranchPublishesReasonStatus(branch, "文件传输元数据无效，请重试", statusPattern);
  assertBranchPublishesReasonStatus(branch, "已有文件正在接收，请等待完成后重试", statusPattern);
  assertBranchPublishesReasonStatus(branch, "当前设备为避免内存崩溃，单文件接收上限", statusPattern);
  assertBranchPublishesReasonStatus(branch, "this.getReceivedCacheLimitMessage", statusPattern);
  assertBranchPublishesReasonStatus(branch, "当前设备内存不足，无法接收该文件，请换小文件或重试", statusPattern);
});

test("server relay incoming request rejection reasons remain visible", () => {
  const body = extractMethodBody(serverFileTransferSource, "private async handleTransferRequest");
  const statusPattern = /this\.setTransferStatus\(\s*reason,\s*"(?:error|warning)"/;

  assertBranchPublishesReasonStatus(body, "文件传输元数据无效，请重试", statusPattern, "return;");
  assertBranchPublishesReasonStatus(body, "当前设备为避免内存崩溃，单文件接收上限", statusPattern, "return;");
  assertBranchPublishesReasonStatus(body, "this.getReceivedCacheLimitMessage", statusPattern, "return;");
});
