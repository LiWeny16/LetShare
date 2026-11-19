import test from "node:test";
import assert from "node:assert/strict";
import {
  getPendingMeetingSummarySegments,
  groupMeetingSummaryTimeline,
  isMeaningfulMeetingASRText,
  maxIncludedMeetingSegmentSeq,
  meetingSummaryDelay,
  mergeMeetingTranscriptSegments,
  nextLatestMeetingSegmentSeq,
} from "../src/app/libs/meeting/meetingSummaryQueue";
import type { MeetingTranscriptSegment } from "../src/app/libs/meeting/meetingAi";

function segment(id: string, seq: number | undefined, recordingId = "recording-a", final = true): MeetingTranscriptSegment {
  return { id, speakerId: "member", speakerName: "Member", text: id, startMs: Number(id.replace(/\D/g, "")) || 0, endMs: 1, final, recordingId, ...(seq === undefined ? {} : { seq }) };
}

test("automatic notes use the content or elapsed-time threshold with a minimum request interval", () => {
  const firstArrival = 100_000;
  const short = [{ text: "讨论下一阶段的计划。" }];
  assert.equal(meetingSummaryDelay(short, firstArrival, 0, firstArrival), 60_000);
  assert.equal(meetingSummaryDelay(short, firstArrival, 0, firstArrival + 59_999), 1);
  assert.equal(meetingSummaryDelay(short, firstArrival, 0, firstArrival + 60_000), 0);
  assert.equal(meetingSummaryDelay([{ text: "字".repeat(219) }], firstArrival, 0, firstArrival + 10_000), 50_000);
  assert.equal(meetingSummaryDelay([{ text: "字".repeat(220) }], firstArrival, 0, firstArrival + 10_000), 0);
  assert.equal(meetingSummaryDelay([{ text: "字".repeat(220) }], firstArrival, firstArrival, firstArrival + 5_000), 15_000);
  assert.equal(meetingSummaryDelay([], firstArrival, 0, firstArrival + 120_000), null);
  assert.equal(meetingSummaryDelay([{ text: "嗯，啊……" }], firstArrival, 0, firstArrival + 120_000), null);
});

test("single-character and filler-only ASR results are ignored without losing meaningful short phrases", () => {
  for (const text of ["", "。", "嗯。", "好！", "嗯 啊，呃……", "哈哈", "hmm, um", "嗯 uh"]) {
    assert.equal(isMeaningfulMeetingASRText(text), false, text);
  }
  for (const text of ["你好", "嗯，可以", "OK", "yes", "嗯，继续讨论"]) {
    assert.equal(isMeaningfulMeetingASRText(text), true, text);
  }
});

test("ignored legacy ASR rows do not create gaps in the shared summary cursor", () => {
  const raw = [
    { ...segment("filler", 1), text: "嗯" },
    { ...segment("real", 2), text: "讨论周五上线" },
    { ...segment("filler-again", 3), text: "啊啊" },
  ];
  const pending = getPendingMeetingSummarySegments(raw, { recordingId: "recording-a", summaryThroughSeq: 0, latestSegmentSeq: 3, cursorEnabled: true });
  const useful = pending.filter((item) => isMeaningfulMeetingASRText(item.text));
  assert.deepEqual(useful.map((item) => item.id), ["real"]);
  assert.equal(maxIncludedMeetingSegmentSeq(useful), 2);
});

test("one synthesized discussion note covers the batch without assigning it to one of several speakers", () => {
  const sources = [
    { ...segment("line-1", 1), speakerId: "ana", speakerName: "Ana", startMs: 90, endMs: 120, text: "We can ship on Friday." },
    { ...segment("line-2", 2), speakerId: "ben", speakerName: "Ben", startMs: 80, endMs: 130, text: "Test the new build first." },
  ];
  const result = groupMeetingSummaryTimeline([{
    id: "generated", speakerName: "", startMs: 99, endMs: 101,
    summary: "The team discussed a Friday release.\nThe new build needs testing before shipping.", transcript: "", kind: "speech",
  }], sources);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    id: "discussion:line-1", speakerName: "", startMs: 80, endMs: 130, kind: "speech",
    summary: "The team discussed a Friday release. The new build needs testing before shipping.",
    transcript: "",
  });
});

test("model speaker guesses cannot replace the single recorded speaker or their words", () => {
  const source = { ...segment("line-1", 1), speakerId: "ana", speakerName: "Ana", text: "I will test it." };
  const result = groupMeetingSummaryTimeline([{
    id: "fabricated", speakerName: "Ben", startMs: 0, endMs: 5,
    summary: "Ben will ship it.", transcript: "Ben will ship it.", kind: "action",
  }], [source]);
  assert.equal(result[0]?.speakerName, "Ana");
  assert.equal(result[0]?.summary, source.text);
  assert.equal(result[0]?.kind, "speech");
});

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

test("live segments raise the latest sequence before any minutes state broadcast", () => {
  assert.equal(nextLatestMeetingSegmentSeq(0, [segment("one", 1), segment("two", 2)], "recording-a"), 2);
  assert.equal(nextLatestMeetingSegmentSeq(undefined, [segment("one", 1)], "recording-a"), 1);
  assert.equal(nextLatestMeetingSegmentSeq(undefined, [], "recording-a"), undefined);
  assert.equal(nextLatestMeetingSegmentSeq(2, [segment("old", 9, "recording-old")], "recording-a"), 2);
  assert.equal(nextLatestMeetingSegmentSeq(5, [segment("one", 3)], "recording-a"), 5);
});

test("raising the latest sequence unblocks the pending summary queue", () => {
  const transcript = [segment("one", 1), segment("two", 2)];
  const latestSegmentSeq = nextLatestMeetingSegmentSeq(0, transcript, "recording-a");
  assert.deepEqual(
    getPendingMeetingSummarySegments(transcript, {
      recordingId: "recording-a",
      summaryThroughSeq: 0,
      latestSegmentSeq,
      cursorEnabled: true,
    }).map(({ id }) => id),
    ["one", "two"],
  );
});
