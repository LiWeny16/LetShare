import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("sendFileAuto does not mistake a transport close for user cancellation", () => {
  const source = readFileSync("src/app/libs/connection/colabLib.ts", "utf8");
  const start = source.indexOf("public async sendFileAuto");
  const end = source.indexOf("\n public generateUUID", start + 1);
  assert.ok(start >= 0 && end > start, "sendFileAuto must exist");
  const body = source.slice(start, end);
  assert.match(body, /const userCancelled = \/cancel\|取消\|撤销\/i/);
  assert.doesNotMatch(body, /const userCancelled = this\.aborted/);
  assert.match(body, /this\.aborted = false;\s*await this\.sendFileViaServer/);
});
