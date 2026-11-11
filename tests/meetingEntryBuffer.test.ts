import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_MEETING_ENTRY_BUFFER_MS,
  markMeetingEntryBufferStart,
  meetingEntryBufferRemainingMs,
  resetMeetingEntryBufferClock,
} from "../src/app/libs/meeting/meetingEntryBuffer";

test("marking the entry buffer start is idempotent", () => {
  resetMeetingEntryBufferClock();
  markMeetingEntryBufferStart(1000);
  markMeetingEntryBufferStart(2000);
  assert.equal(
    meetingEntryBufferRemainingMs(1000 + MIN_MEETING_ENTRY_BUFFER_MS / 2),
    MIN_MEETING_ENTRY_BUFFER_MS / 2,
    "a second mark must not move the clock",
  );
  resetMeetingEntryBufferClock();
});

test("remaining buffer time clamps at zero", () => {
  resetMeetingEntryBufferClock();
  assert.equal(meetingEntryBufferRemainingMs(0), 0, "an unset clock reports no buffer");
  markMeetingEntryBufferStart(0);
  assert.equal(meetingEntryBufferRemainingMs(MIN_MEETING_ENTRY_BUFFER_MS), 0, "the buffer never goes negative");
  assert.equal(meetingEntryBufferRemainingMs(MIN_MEETING_ENTRY_BUFFER_MS + 500), 0, "late reads stay at zero");
  assert.equal(meetingEntryBufferRemainingMs(200), MIN_MEETING_ENTRY_BUFFER_MS - 200);
  resetMeetingEntryBufferClock();
});

test("reset clears the clock", () => {
  markMeetingEntryBufferStart(0);
  resetMeetingEntryBufferClock();
  assert.equal(meetingEntryBufferRemainingMs(100), 0, "after reset the buffer is unset again");
  markMeetingEntryBufferStart(1000);
  assert.equal(meetingEntryBufferRemainingMs(1000), MIN_MEETING_ENTRY_BUFFER_MS, "a new entry restarts the full buffer");
  resetMeetingEntryBufferClock();
});
