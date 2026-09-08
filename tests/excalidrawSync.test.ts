import test from "node:test";
import assert from "node:assert/strict";
import { shouldPublishExcalidrawChange } from "../src/components/meeting/excalidrawSync";

test("Excalidraw initial empty onChange is not published", () => {
  assert.equal(shouldPublishExcalidrawChange([], false), false);
});

test("Excalidraw publishes a non-empty scene", () => {
  assert.equal(shouldPublishExcalidrawChange([{ id: "element-1" }], false), true);
});

test("Excalidraw can publish an intentional clear after a scene exists", () => {
  assert.equal(shouldPublishExcalidrawChange([], true), true);
});
