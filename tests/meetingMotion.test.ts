import test from "node:test";
import assert from "node:assert/strict";
import { isLowEndMeetingDevice } from "../src/components/meeting/meetingMotion";

test("meeting motion disables fades when a known hardware hint is low", () => {
  assert.equal(isLowEndMeetingDevice({ deviceMemory: 4, hardwareConcurrency: 8 }), true);
  assert.equal(isLowEndMeetingDevice({ deviceMemory: 8, hardwareConcurrency: 4 }), true);
  assert.equal(isLowEndMeetingDevice({ deviceMemory: 8, hardwareConcurrency: 8 }), false);
  assert.equal(isLowEndMeetingDevice({}), false);
  assert.equal(isLowEndMeetingDevice({ deviceMemory: 0, hardwareConcurrency: 0 }), false);
});
