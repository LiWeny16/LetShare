import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExcalidrawElementDelta,
  classifyExcalidrawOperation,
  cloneExcalidrawElements,
  compactLaserPointer,
  compactWhiteboardViewport,
  mergeExcalidrawElementDelta,
  operationSyncPolicy,
  resolveLaserPointerPhase,
  selectExcalidrawFiles,
  shouldPublishExcalidrawChange,
} from "../src/components/meeting/excalidrawSync";

test("Excalidraw initial empty onChange is not published", () => {
  assert.equal(shouldPublishExcalidrawChange([], false), false);
});

test("Excalidraw publishes a non-empty scene", () => {
  assert.equal(shouldPublishExcalidrawChange([{ id: "element-1" }], false), true);
});

test("Excalidraw can publish an intentional clear after a scene exists", () => {
  assert.equal(shouldPublishExcalidrawChange([], true), true);
});

test("Excalidraw scene sync keeps binary files referenced by image elements", () => {
  const files = {
    "image-1": { id: "image-1", dataURL: "data:image/png;base64,one" },
    "unused-image": { id: "unused-image", dataURL: "data:image/png;base64,two" },
  };
  assert.deepEqual(
    selectExcalidrawFiles([
      { id: "image-element", type: "image", fileId: "image-1" },
      { id: "rectangle", type: "rectangle" },
    ], files),
    { "image-1": files["image-1"] },
  );
});

test("Excalidraw delta keeps only the new tail of a growing freehand element", () => {
  const previous = [{ id: "stroke-1", type: "freedraw", version: 1, points: [[0, 0], [1, 1]] }];
  const current = [{ id: "stroke-1", type: "freedraw", version: 2, points: [[0, 0], [1, 1], [2, 2], [3, 3]] }];
  assert.deepEqual(buildExcalidrawElementDelta(current, previous), [{
    id: "stroke-1",
    type: "freedraw",
    version: 2,
    pointsBase: 2,
    pointsAppend: [[2, 2], [3, 3]],
  }]);
});

test("Excalidraw acknowledged elements are snapshots, not mutable editor references", () => {
  const editorElement = { id: "stroke", version: 1, points: [[0, 0]] };
  const acknowledged = cloneExcalidrawElements([editorElement]);
  editorElement.points.push([1, 1]);
  assert.deepEqual(buildExcalidrawElementDelta([editorElement], acknowledged), [{
    id: "stroke",
    version: 1,
    pointsBase: 1,
    pointsAppend: [[1, 1]],
  }]);
});

test("Excalidraw delta merge is idempotent and preserves concurrent elements", () => {
  const base = [{ id: "remote", type: "rectangle", version: 1, x: 10 }];
  const delta = [
    { id: "remote", type: "rectangle", version: 2, x: 20 },
    { id: "local", type: "freedraw", version: 1, points: [[0, 0]] },
  ];
  const once = mergeExcalidrawElementDelta(base, delta);
  assert.deepEqual(mergeExcalidrawElementDelta(once, delta), once);
  assert.deepEqual(once, [
    { id: "remote", type: "rectangle", version: 2, x: 20 },
    { id: "local", type: "freedraw", version: 1, points: [[0, 0]] },
  ]);
});

test("replaying a freehand tail delta does not duplicate points", () => {
  const base = [{ id: "stroke", type: "freedraw", version: 1, points: [[0, 0], [1, 1]] }];
  const delta = [{ id: "stroke", type: "freedraw", version: 2, pointsBase: 2, pointsAppend: [[2, 2]] }];
  const once = mergeExcalidrawElementDelta(base, delta);
  assert.deepEqual(mergeExcalidrawElementDelta(once, delta), once);
  assert.deepEqual(once[0].points, [[0, 0], [1, 1], [2, 2]]);
});

test("a same-version freehand tail is accepted only at its declared base length", () => {
  const base = [{ id: "stroke", type: "freedraw", version: 7, points: [[0, 0], [1, 1]] }];
  const delta = [{ id: "stroke", type: "freedraw", version: 7, pointsBase: 2, pointsAppend: [[2, 2]] }];
  const once = mergeExcalidrawElementDelta(base, delta);
  assert.deepEqual(once[0].points, [[0, 0], [1, 1], [2, 2]]);
  assert.deepEqual(mergeExcalidrawElementDelta(once, delta), once);
});

test("a stale freehand tail cannot replace the element without points", () => {
  const base = [{ id: "stroke", type: "freedraw", version: 9, points: [[0, 0], [1, 1], [2, 2]] }];
  const stale = [{ id: "stroke", type: "freedraw", version: 10, pointsBase: 2, pointsAppend: [[3, 3]] }];
  assert.deepEqual(mergeExcalidrawElementDelta(base, stale), base);
});

test("laser pointer frames are quantized and bounded instead of carrying raw pointer noise", () => {
  assert.deepEqual(compactLaserPointer(0.1234567, 1.2, "move"), { x: 0.123, y: 1, phase: "move" });
  assert.deepEqual(compactLaserPointer(-0.2, 0.56789, "end"), { x: 0, y: 0.568, phase: "end" });
});

test("laser pointer ignores hover/up events until the pointer is actually pressed", () => {
  assert.equal(resolveLaserPointerPhase("up", false), null);
  assert.deepEqual(resolveLaserPointerPhase("down", false), { phase: "start", active: true });
  assert.deepEqual(resolveLaserPointerPhase("down", true), { phase: "move", active: true });
  assert.deepEqual(resolveLaserPointerPhase("up", true), { phase: "end", active: false });
});

test("whiteboard viewport sync uses a device-independent scene center", () => {
  assert.deepEqual(
    compactWhiteboardViewport({ scrollX: -320, scrollY: -180, zoom: { value: 1.25 } }, 1000, 700),
    { centerX: 720, centerY: 460, zoom: 1.25 },
  );
});

test("whiteboard operations choose an immediate policy for destructive changes", () => {
  const operation = classifyExcalidrawOperation(
    [{ id: "shape", isDeleted: true, version: 2 }],
    [{ id: "shape", type: "rectangle", version: 1 }],
    [{ id: "shape", isDeleted: true, version: 2 }],
  );
  assert.equal(operation.kind, "delete");
  assert.deepEqual(operationSyncPolicy(operation.kind), { delayMs: 0, maxBytes: 0, maxItems: 1 });
});

test("whiteboard operations batch freehand tails instead of sending every point", () => {
  const operation = classifyExcalidrawOperation(
    [{ id: "stroke", type: "freedraw", version: 2, points: [[0, 0], [1, 1], [2, 2]] }],
    [{ id: "stroke", type: "freedraw", version: 1, points: [[0, 0], [1, 1]] }],
    [{ id: "stroke", type: "freedraw", version: 2, pointsBase: 2, pointsAppend: [[2, 2]] }],
  );
  assert.equal(operation.kind, "stroke-append");
  assert.deepEqual(operationSyncPolicy(operation.kind), { delayMs: 80, maxBytes: 3072, maxItems: 32 });
});

test("whiteboard image operations flush immediately because peers need the asset reference", () => {
  const operation = classifyExcalidrawOperation(
    [{ id: "image", type: "image", fileId: "file-1", version: 1 }],
    [],
    [{ id: "image", type: "image", fileId: "file-1", version: 1 }],
    true,
  );
  assert.equal(operation.kind, "image");
  assert.equal(operationSyncPolicy(operation.kind).delayMs, 0);
});
