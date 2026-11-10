import test from "node:test";
import assert from "node:assert/strict";
import { buildMeetingAIContext, buildMeetingSummaryBatch } from "../src/app/libs/meeting/meetingAIContext";
import type { MeetingTranscriptSegment } from "../src/app/libs/meeting/meetingAi";

function make(index: number, text: string, final = true): MeetingTranscriptSegment {
  return { id: `id-${index}`, speakerId: "member", speakerName: "成员", startMs: index, endMs: index, text, final };
}

test("meeting AI context is bounded by UTF-8 bytes and preserves recent final IDs", () => {
  const input = Array.from({ length: 20 }, (_, index) => make(index, "会议讨论".repeat(400)));
  input.push(make(21, "临时结果不发送", false));
  const encoded = buildMeetingAIContext(input, { question: "决定了什么？", previousSummary: "已有记录" });
  assert.ok(new TextEncoder().encode(encoded).length <= 14_000);
  const data = JSON.parse(encoded);
  assert.equal(data.question, "决定了什么？");
  assert.ok(data.segments.length > 0);
  assert.equal(data.segments.at(-1).id, "id-19");
  assert.ok(data.segments.every((item: { text: string }) => !item.text.includes("临时结果")));
});

test("summary batches preserve queued utterances in order without dropping the remainder", () => {
  const remaining = Array.from({ length: 20 }, (_, index) => make(index, "会议讨论".repeat(300)));
  const seen: string[] = [];
  while (remaining.length) {
    const batch = buildMeetingSummaryBatch(remaining, JSON.stringify({ decisions: [{ text: "previous decision" }] }));
    assert.ok(batch.includedCount > 0);
    assert.ok(new TextEncoder().encode(batch.input).length <= 14_000);
    const data = JSON.parse(batch.input);
    assert.equal(data.previousSummary.decisions[0].text, "previous decision");
    seen.push(...data.segments.map((item: { id: string }) => item.id));
    remaining.splice(0, batch.includedCount);
  }
  assert.deepEqual(seen, Array.from({ length: 20 }, (_, index) => `id-${index}`));
});

test("summary batching explicitly reports when old context cannot fit with a new utterance", () => {
  const batch = buildMeetingSummaryBatch([make(1, "中".repeat(4_000))], JSON.stringify({ overview: "先".repeat(4_000) }));
  assert.equal(batch.previousOmitted, true);
  assert.equal(batch.includedCount, 1);
  assert.ok(new TextEncoder().encode(batch.input).length <= 14_000);
});

test("long meetings keep advancing with compact prior context and retain core summary sections", () => {
  const previousSummary = JSON.stringify({
    meetingTitle: "Long planning session",
    overview: "overview ".repeat(500),
    decisions: Array.from({ length: 24 }, (_, index) => ({ text: `decision ${index} ` + "決".repeat(80), timeMs: index })),
    actionItems: Array.from({ length: 24 }, (_, index) => ({ task: `task ${index} ` + "行動".repeat(50), owner: "Owner", deadline: "Friday", timeMs: index })),
    openQuestions: Array.from({ length: 18 }, (_, index) => ({ question: `question ${index} ` + "問題".repeat(50), timeMs: index })),
    timeline: Array.from({ length: 80 }, (_, index) => ({
      id: `meeting-note-${index}`, startMs: index, endMs: index + 1, speakerName: "Member",
      summary: "summary ".repeat(40), transcript: "transcript ".repeat(40), kind: "speech",
    })),
  });
  const remaining = Array.from({ length: 60 }, (_, index) => make(index, "這是一段較長的會議發言。".repeat(35)));
  const processed: string[] = [];
  let sawCompaction = false;
  while (remaining.length) {
    const batch = buildMeetingSummaryBatch(remaining, previousSummary);
    assert.ok(batch.includedCount > 0, "each summary response can move the cursor forward");
    assert.ok(new TextEncoder().encode(batch.input).length <= 14_000);
    const data = JSON.parse(batch.input);
    assert.ok(data.previousSummary.overview, "the compact context retains the overview");
    assert.ok(data.previousSummary.decisions?.length, "the compact context retains decisions");
    assert.ok(data.previousSummary.actionItems?.length, "the compact context retains action items");
    assert.ok(data.previousSummary.timeline?.length, "the compact context retains recent timeline nodes");
    processed.push(...data.segments.map((item: { id: string }) => item.id));
    sawCompaction ||= batch.contentTruncated;
    remaining.splice(0, batch.includedCount);
  }
  assert.equal(processed.length, 60);
  assert.equal(sawCompaction, true, "omitted earlier context is reported while processing continues");
});

test("meeting AI context can express an unanswered question without inventing transcript data", () => {
  const data = JSON.parse(buildMeetingAIContext([], { question: "刚才谁说了什么？" }));
  assert.deepEqual(data.segments, []);
  assert.equal(data.question, "刚才谁说了什么？");
});
