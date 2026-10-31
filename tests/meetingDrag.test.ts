import test from "node:test";
import assert from "node:assert/strict";
import { clampSharingPosition, panelWidthForPointer } from "../src/components/meeting/meetingDrag";

test("panel resizing follows pointer direction and retains the close threshold", () => {
  assert.deepEqual(panelWidthForPointer(320, 400, 350), { width: 370, close: false });
  assert.deepEqual(panelWidthForPointer(320, 400, 460), { width: 260, close: false });
  assert.deepEqual(panelWidthForPointer(320, 400, 476), { width: 260, close: true });
  assert.deepEqual(panelWidthForPointer(320, 400, 0), { width: 520, close: false });
});

test("sharing controls remain inside viewport bounds after dragging or resizing", () => {
  assert.deepEqual(clampSharingPosition(300, 200, 800, 600, 200, 60), { left: 300, top: 200 });
  assert.deepEqual(clampSharingPosition(-100, -10, 800, 600, 200, 60), { left: 12, top: 10 });
  assert.deepEqual(clampSharingPosition(900, 900, 800, 600, 200, 60), { left: 588, top: 530 });
  assert.deepEqual(clampSharingPosition(900, 900, 150, 50, 200, 60), { left: 12, top: 10 });
});
