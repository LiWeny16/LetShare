import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src", "app", "libs", "connection", "ServerFileTransfer.ts"),
  "utf8"
);

function extractMethodBody(sourceText: string, methodName: string): string {
  const methodIndex = sourceText.indexOf(methodName);
  assert.notEqual(methodIndex, -1, `method ${methodName} should exist`);

  const parenStart = sourceText.indexOf("(", methodIndex);
  assert.notEqual(parenStart, -1, `method ${methodName} should have params`);

  let depth = 0;
  let bodyStart = -1;
  for (let index = parenStart; index < sourceText.length; index++) {
    if (sourceText[index] === "(") {
      depth++;
    } else if (sourceText[index] === ")") {
      depth--;
      if (depth === 0) {
        bodyStart = sourceText.indexOf("{", index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `method ${methodName} should have a body`);

  depth = 0;
  for (let index = bodyStart; index < sourceText.length; index++) {
    if (sourceText[index] === "{") {
      depth++;
    } else if (sourceText[index] === "}") {
      depth--;
      if (depth === 0) {
        return sourceText.slice(bodyStart + 1, index);
      }
    }
  }

  assert.fail(`method ${methodName} body should close`);
}

test("server relay ignores late binary chunks for an already completed transfer", () => {
  const body = extractMethodBody(source, "public handleBinaryData");
  const completedGuardIndex = body.indexOf("this.completedTransferIds.has(meta.transfer_id)");
  const missingSessionErrorIndex = body.indexOf("alert.chunkWithoutTransfer");

  assert.notEqual(
    missingSessionErrorIndex,
    -1,
    "missing receive-session error branch should exist"
  );
  assert.notEqual(
    completedGuardIndex,
    -1,
    "handleBinaryData should check completed transfer ids before reporting missing-session chunks"
  );
  assert.ok(
    completedGuardIndex < missingSessionErrorIndex,
    "late chunks for completed transfers must be ignored before the missing-session error branch"
  );

  const completedGuardBranch = body.slice(completedGuardIndex, missingSessionErrorIndex);
  assert.match(
    completedGuardBranch,
    /return;/,
    "completed-transfer chunk guard should return without sending cancel or showing an error"
  );
});

test("server relay receive completion publishes the same persistent success status as P2P", () => {
  const body = extractMethodBody(source, "private finalizeReceivedFile");
  const successAlertIndex = body.indexOf("toast.fileReceived");
  const statusIndex = body.indexOf("this.setTransferStatus(t('alert.fileReceivedComplete'), \"success\")");

  assert.notEqual(successAlertIndex, -1, "receive completion success toast should exist");
  assert.notEqual(
    statusIndex,
    -1,
    "server relay receive completion should publish a persistent success status"
  );
  assert.ok(
    statusIndex < successAlertIndex,
    "persistent completion status should be updated before the transient success toast"
  );
});
