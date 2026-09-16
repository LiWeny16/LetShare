import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import {
  clearMeetingMinutesHistory,
  listMeetingMinutesHistory,
  saveMeetingMinutesHistory,
  type MeetingMinutesHistoryRecord,
} from "../src/app/libs/meeting/meetingMinutesHistory";

function record(id: string, endedAt: number): MeetingMinutesHistoryRecord {
  return {
    id,
    roomId: "4321",
    title: "产品方案评审会",
    startedAt: endedAt - 60_000,
    endedAt,
    savedAt: endedAt,
    summary: JSON.stringify({ meetingTitle: "产品方案评审会", overview: "已完成接口方案确认" }),
    summaryData: {
      meetingTitle: "产品方案评审会",
      overview: "已完成接口方案确认",
      timeline: [],
      decisions: [{ text: "第一阶段兼容标准接口", timeMs: endedAt - 20_000 }],
      actionItems: [],
      openQuestions: [],
    },
    transcript: [{ id: "segment-1", speakerId: "member-1", speakerName: "成员 A", text: "我建议先兼容标准接口。", startMs: endedAt - 20_000, endMs: endedAt - 20_000, final: true }],
    timeline: [],
  };
}

test("meeting minutes history persists structured summary and replaces duplicate sessions", async () => {
  await clearMeetingMinutesHistory();
  await saveMeetingMinutesHistory(record("meeting-1", 100));
  await saveMeetingMinutesHistory({ ...record("meeting-1", 200), summary: "updated" });
  await saveMeetingMinutesHistory(record("meeting-2", 150));

  const history = await listMeetingMinutesHistory();
  assert.deepEqual(history.map((item) => item.id), ["meeting-1", "meeting-2"]);
  assert.equal(history[0].summary, "updated");
  assert.equal(history[0].summaryData?.decisions[0].text, "第一阶段兼容标准接口");
  assert.equal(history[0].transcript[0].speakerName, "成员 A");
});
