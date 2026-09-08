import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("P2P completion emits file-received so meeting chat can render the file", () => {
  const source = readFileSync("src/app/libs/connection/colabLib.ts", "utf8");
  const start = source.indexOf("private async completeP2PReceive");
  const end = source.indexOf("\n  private ", start + 1);
  assert.ok(start >= 0 && end > start, "completeP2PReceive must exist");
  const body = source.slice(start, end);
  assert.match(
    body,
    /this\.emitter\.emit\(['"]file-received['"]/,
    "P2P completion must notify the shared chat/file history pipeline",
  );
});
