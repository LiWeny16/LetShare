import test from "node:test";
import assert from "node:assert/strict";
import {
  replayDrawEvents,
  strokeHitTest,
  type DrawEvent,
} from "../src/components/meeting/components/whiteboardOps";

function strokeEv(opId: string, pts: number[], width = 3): DrawEvent {
  return { op: "stroke", opId, color: "#1677ff", width, pts };
}

test("replay: strokes accumulate, erase removes whole strokes (not clear)", () => {
  const events: DrawEvent[] = [
    strokeEv("s1", [0, 0, 0.2, 0.2]),
    strokeEv("s2", [0.5, 0.5, 0.7, 0.7]),
    { op: "erase", opId: "e1", erasedOpIds: ["s1"] },
  ];
  const visible = replayDrawEvents(events, new Set());
  assert.equal(visible.length, 1);
  assert.equal(visible[0].opId, "s2");
});

test("replay: clear empties board but later strokes survive", () => {
  const events: DrawEvent[] = [
    strokeEv("s1", [0, 0, 0.2, 0.2]),
    { op: "clear", opId: "c1" },
    strokeEv("s2", [0.5, 0.5, 0.7, 0.7]),
  ];
  const visible = replayDrawEvents(events, new Set());
  assert.equal(visible.length, 1);
  assert.equal(visible[0].opId, "s2");
});

test("replay: undone stroke disappears and redo restores it", () => {
  const events: DrawEvent[] = [strokeEv("s1", [0, 0, 0.2, 0.2]), strokeEv("s2", [0.5, 0.5])];
  const undone = new Set<string>();
  undone.add("s2"); // undo s2
  assert.equal(replayDrawEvents(events, undone).length, 1);
  undone.delete("s2"); // redo
  assert.equal(replayDrawEvents(events, undone).length, 2);
});

test("replay: undone clear restores earlier strokes (clear is undoable)", () => {
  const events: DrawEvent[] = [
    strokeEv("s1", [0, 0, 0.2, 0.2]),
    { op: "clear", opId: "c1" },
  ];
  const undone = new Set<string>(["c1"]);
  assert.equal(replayDrawEvents(events, undone).length, 1);
});

test("replay: undoing a remote erase restores the erased stroke", () => {
  const events: DrawEvent[] = [
    strokeEv("bob-stroke", [0.1, 0.5, 0.8, 0.5]),
    { op: "erase", opId: "alice-erase", erasedOpIds: ["bob-stroke"] },
  ];
  // Undo is a shared meeting operation: the participant whose stroke was erased
  // can undo the erase and every client replays the same visible result.
  assert.equal(replayDrawEvents(events, new Set()).length, 0);
  assert.equal(replayDrawEvents(events, new Set(["alice-erase"])).length, 1);
  assert.equal(replayDrawEvents(events, new Set(["alice-erase"]))[0].opId, "bob-stroke");
});

test("replay: erase of an undone-clear scenario stays deterministic", () => {
  const events: DrawEvent[] = [
    strokeEv("s1", [0, 0, 0.2, 0.2]),
    { op: "erase", opId: "e1", erasedOpIds: ["s1"] },
    { op: "clear", opId: "c1" },
  ];
  // 未撤销任何事件 → erase 移除 s1 + clear 清空 → 空
  assert.equal(replayDrawEvents(events, new Set()).length, 0);
  // 只撤销 erase：s1 恢复后仍被 clear 清掉 → 空
  assert.equal(replayDrawEvents(events, new Set(["e1"])).length, 0);
  // 撤销 erase + clear → s1 可见
  assert.equal(replayDrawEvents(events, new Set(["e1", "c1"])).length, 1);
});

test("eraser hit test: strokes near the eraser path are hit, far strokes are not", () => {
  const canvasW = 1000;
  const canvasH = 1000;
  const horizontal = { pts: [0.1, 0.5, 0.5, 0.5], width: 4 };
  const vertical = { pts: [0.8, 0.1, 0.8, 0.9], width: 4 };
  const radiusNorm = 14 / canvasW;

  // 橡皮在水平笔画中段附近 → 命中
  assert.equal(strokeHitTest(horizontal, 0.3, 0.502, radiusNorm, canvasW, canvasH), true);
  // 橡皮在垂直笔画附近 → 命中
  assert.equal(strokeHitTest(vertical, 0.801, 0.5, radiusNorm, canvasW, canvasH), true);
  // 橡皮远离两条笔画 → 都不命中
  assert.equal(strokeHitTest(horizontal, 0.3, 0.9, radiusNorm, canvasW, canvasH), false);
  assert.equal(strokeHitTest(vertical, 0.3, 0.5, radiusNorm, canvasW, canvasH), false);
  // 单点笔画命中（点画）
  const dot = { pts: [0.5, 0.5], width: 6 };
  assert.equal(strokeHitTest(dot, 0.5, 0.5, radiusNorm, canvasW, canvasH), true);
  assert.equal(strokeHitTest(dot, 0.9, 0.9, radiusNorm, canvasW, canvasH), false);
});
