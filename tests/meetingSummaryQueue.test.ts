import test from "node:test";
import assert from "node:assert/strict";
import {
  getPendingMeetingSummarySegments,
  maxIncludedMeetingSegmentSeq,
  mergeMeetingTranscriptSegments,
} from "../src/app/libs/meeting/meetingSummaryQueue";
import type { MeetingTranscriptSegment } from "../src/app/libs/meeting/meetingAi";

function segment(id: string, seq: number | undefined, recordingId = "recording-a", final = true): MeetingTranscriptSegment {
  return { id, speakerId: "member", speakerName: "Member", text: id, startMs: Number(id.replace(/\D/g, "")) || 0, endMs: 1, final, recordingId, ...(seq === undefined ? {} : { seq }) };
}

test("summary queue selects only a contiguous final tail for the active recording", () => {
  const transcript = [
    segment("old", 1, "recording-old"),
    segment("covered", 1),
    segment("next", 2),
    segment("interim", 3, "recording-a", false),
    segment("gap-after", 4),
    segment("other-recording", 5, "recording-b"),
  ];

  assert.deepEqual(
    getPendingMeetingSummarySegments(transcript, {
      recordingId: "recording-a",
      summaryThroughSeq: 1,
      latestSegmentSeq: 4,
      cursorEnabled: true,
    }).map(({ id }) => id),
    ["next"],
  );
  assert.deepEqual(
    getPendingMeetingSummarySegments(transcript, {
      recordingId: "recording-a",
      summaryThroughSeq: 2,
      latestSegmentSeq: 4,
      cursorEnabled: true,
    }),
    [],
  );
});

test("replay gaps hold later segments until the missing sequence arrives", () => {
  const replay = [segment("one", 1), segment("three", 3)];
  const options = { recordingId: "recording-a", summaryThroughSeq: 0, latestSegmentSeq: 3, cursorEnabled: true };
  assert.deepEqual(getPendingMeetingSummarySegments(replay, options).map(({ id }) => id), ["one"]);
  const complete = mergeMeetingTranscriptSegments(replay, [segment("two", 2)]);
  assert.deepEqual(getPendingMeetingSummarySegments(complete, options).map(({ id }) => id), ["one", "two", "three"]);
});

test("a pruned transcript history resumes from the first retained sequence", () => {
  const retained = [segment("retained-8", 8), segment("retained-9", 9)];
  assert.deepEqual(
    getPendingMeetingSummarySegments(retained, {
      recordingId: "recording-a",
      summaryThroughSeq: 3,
      historyStartSeq: 8,
      latestSegmentSeq: 9,
      cursorEnabled: true,
    }).map(({ id }) => id),
    ["retained-8", "retained-9"],
  );
});

test("server echoes enrich local transcript rows without regressing final text", () => {
  const local = { ...segment("local", undefined), text: "final local text" };
  const echoed = { ...segment("local", 7), speakerName: "", text: "server text", final: false };
  const merged = mergeMeetingTranscriptSegments([local], [echoed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].seq, 7);
  assert.equal(merged[0].text, "final local text");
  assert.equal(merged[0].final, true);
});

test("shared transcript flow follows server sequence even when timestamps arrive out of order", () => {
  const merged = mergeMeetingTranscriptSegments([], [
    { ...segment("seq-2", 2), startMs: 100 },
    { ...segment("seq-1", 1), startMs: 900 },
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["seq-1", "seq-2"]);
});

test("summary cursor advances only through rows actually included in the batch", () => {
  assert.equal(maxIncludedMeetingSegmentSeq([segment("one", 1), segment("two", 2)]), 2);
  assert.equal(maxIncludedMeetingSegmentSeq([segment("legacy", undefined)]), undefined);
});

test("legacy servers can still queue final rows from the active recording", () => {
  assert.deepEqual(
    getPendingMeetingSummarySegments([segment("one", undefined), segment("two", undefined, "recording-a", false)], {
      recordingId: "recording-a",
      cursorEnabled: false,
    }).map(({ id }) => id),
    ["one"],
  );
});
