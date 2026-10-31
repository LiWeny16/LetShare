import test from "node:test";
import assert from "node:assert/strict";
import { limitMeetingTitle } from "../src/app/libs/meeting/meetingTitle";
import { ensureMeetingMinutesSession } from "../src/app/libs/meeting/meetingMinutesSession";

test("meeting titles respect the server's byte limit without splitting Chinese or emoji", () => {
  assert.equal(limitMeetingTitle("a".repeat(70)), "a".repeat(64));
  assert.equal(limitMeetingTitle("会".repeat(22)), "会".repeat(21));
  assert.equal(limitMeetingTitle("会议" + "😀".repeat(20)), "会议" + "😀".repeat(14));
});

test("meeting minutes follow a renamed meeting without replacing the session", () => {
  const initial = ensureMeetingMinutesSession("title-test-room", "最初名称");
  const renamed = ensureMeetingMinutesSession("title-test-room", "新名称");
  assert.equal(renamed.sessionId, initial.sessionId);
  assert.equal(renamed.title, "新名称");
});
