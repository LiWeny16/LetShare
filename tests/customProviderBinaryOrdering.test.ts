import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src", "app", "libs", "connection", "providers", "CustomConnectionProvider.ts"),
  "utf8"
);

test("custom websocket receives relay binary frames as ArrayBuffer to preserve message order", () => {
  const websocketCreationIndex = source.indexOf("this.ws = new WebSocket(url)");
  const binaryTypeIndex = source.indexOf('this.ws.binaryType = "arraybuffer"');
  const onMessageIndex = source.indexOf("this.ws.onmessage");

  assert.notEqual(websocketCreationIndex, -1, "provider should create a websocket");
  assert.notEqual(onMessageIndex, -1, "provider should register an onmessage handler");
  assert.notEqual(
    binaryTypeIndex,
    -1,
    "provider should request ArrayBuffer binary messages instead of async Blob conversion"
  );
  assert.ok(
    websocketCreationIndex < binaryTypeIndex && binaryTypeIndex < onMessageIndex,
    "binaryType must be set immediately after websocket creation and before messages can arrive"
  );
});
