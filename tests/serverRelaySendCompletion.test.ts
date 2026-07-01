import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src", "app", "libs", "connection", "ServerFileTransfer.ts"),
  "utf8"
);
const serverWebSocketSource = readFileSync(
  join(process.cwd(), "server", "internal", "handler", "websocket.go"),
  "utf8"
);

function extractMethodBody(name: string): string {
  const start = source.indexOf(name);
  assert.notEqual(start, -1, `${name} should exist`);
  const signatureMatch = /\)\s*(?::[^{]+)?\{/.exec(source.slice(start));
  assert.notEqual(signatureMatch, null, `${name} should have a method signature`);
  const braceStart =
    start + signatureMatch!.index + signatureMatch![0].lastIndexOf("{");
  assert.notEqual(braceStart, -1, `${name} should have a body`);

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const char = source[i];
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth === 0) return source.slice(braceStart + 1, i);
  }
  throw new Error(`${name} body did not terminate`);
}

test("server relay send promise resolves only after receiver completion ack", () => {
  assert.match(source, /sendCompletionWaiters:\s*Map</);

  const sendBody = extractMethodBody("public async sendFileViaServer");
  assert.match(sendBody, /const waiterPromise = new Promise<void>\(\(resolve,\s*reject\) =>/);
  assert.match(sendBody, /this\.sendCompletionWaiters\.set\(transferId,\s*\{\s*resolve,\s*reject:\s*wrappedReject\s*\}\)/);
  assert.match(sendBody, /return waiterPromise/);

  const startBody = extractMethodBody("private async startSending");
  const ackIndex = startBody.indexOf("this.completionAcks.waitForAck");
  const resolveIndex = startBody.indexOf("this.resolveSendCompletion");
  assert.notEqual(ackIndex, -1, "startSending should wait for receiver completion ack");
  assert.ok(resolveIndex > ackIndex, "send promise should resolve after receiver ack");
});

test("server relay send promise rejects on request timeout, rejection, cancel, error, and disconnect", () => {
  assert.match(extractMethodBody("private scheduleRequestTimeout"), /this\.rejectSendCompletion\(transferId,/);
  assert.match(extractMethodBody("private handleTransferReject"), /this\.rejectSendCompletion\(transferId,/);
  assert.match(extractMethodBody("private handleTransferCancel"), /this\.rejectSendCompletion\(data\.transfer_id,/);
  assert.match(extractMethodBody("private handleTransferError"), /this\.rejectSendCompletion\(data\.transfer_id,/);
  assert.match(extractMethodBody("public handleConnectionLost"), /this\.rejectAllSendCompletions\(/);
  assert.match(extractMethodBody("public cancelCurrentTransfer"), /this\.rejectSendCompletion\(this\.currentSendingTransferId,/);
});

test("server relay receiver finalizes only after server transfer end", () => {
  const writeBody = extractMethodBody("private writeChunkToSession");
  assert.doesNotMatch(writeBody, /finalizeReceivedFile/);
  assert.match(writeBody, /this\.refreshReceiveTimeout\(session\.transferId\)/);

  const endBody = extractMethodBody("private handleTransferEnd");
  assert.match(endBody, /this\.finalizeReceivedFile\(receiveSession\)/);
});

test("server relay current-transfer cancel also cancels active receiving sessions", () => {
  const cancelBody = extractMethodBody("public cancelCurrentTransfer");
  assert.match(cancelBody, /this\.receivingSessions\.values\(\)/);
  assert.match(cancelBody, /FILE_TRANSFER_MESSAGE_TYPES\.CANCEL/);
  assert.match(cancelBody, /this\.receivingSessions\.delete\(session\.transferId\)/);
  assert.match(cancelBody, /this\.clearReceiveTimeout\(session\.transferId\)/);
});

test("server relay request-stage errors include transfer id so sender can leave waiting state", () => {
  const requestHandlerIndex = serverWebSocketSource.indexOf("func (h *WebSocketHandler) handleFileTransferRequest");
  assert.notEqual(requestHandlerIndex, -1, "handleFileTransferRequest should exist");
  const body = serverWebSocketSource.slice(requestHandlerIndex, serverWebSocketSource.indexOf("// handleFileTransferAccept", requestHandlerIndex));

  assert.match(body, /CreateTransferSession\(&request\)/);
  assert.match(
    body,
    /if err != nil \{[\s\S]*h\.sendFileTransferError\(client,\s*400,\s*err\.Error\(\),\s*request\.TransferID\)/,
    "CreateTransferSession failures must preserve request.TransferID"
  );
});

test("server relay terminal sender messages clear current sending transfer id", () => {
  for (const methodName of [
    "private handleTransferReject",
    "private handleTransferCancel",
    "private handleTransferError",
  ]) {
    const body = extractMethodBody(methodName);
    assert.match(
      body,
      /if\s*\(\s*this\.currentSendingTransferId\s*===\s*(?:transferId|data\.transfer_id)\s*\)\s*\{\s*this\.currentSendingTransferId\s*=\s*null;\s*\}/,
      `${methodName} should clear currentSendingTransferId for the terminal transfer`
    );
  }
});

test("malformed server relay messages reject the send waiter when they stop a sender", () => {
  const body = extractMethodBody("private handleMalformedTransferMessage");
  const senderStopIndex = body.indexOf('sendingSession.status = "error"');
  assert.notEqual(senderStopIndex, -1, "malformed sender-stop branch should exist");

  const senderStopBranch = body.slice(senderStopIndex);
  assert.match(
    senderStopBranch,
    /this\.rejectSendCompletion\(transferId,\s*new Error\(reason\)\)/,
    "malformed messages with a transfer id must reject the public send promise"
  );
});
