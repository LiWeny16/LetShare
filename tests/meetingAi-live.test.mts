import test from "node:test";
import assert from "node:assert/strict";
import { parseMeetingMinutesJson, requestMeetingSummary, type MeetingTranscriptSegment } from "../src/app/libs/meeting/meetingAi";

test("MiMo Token Plan returns a structured meeting minutes JSON", { timeout: 90_000 }, async (t) => {
  const apiKey = process.env.MIMO_TEST_KEY?.trim();
  if (!apiKey) {
    t.skip("set MIMO_TEST_KEY to run the live MiMo check");
    return;
  }
  const now = Date.now();
  const segments: MeetingTranscriptSegment[] = [
    { id: "live-member-1", speakerId: "member-1", speakerName: "成员 A", text: "我建议第一阶段先兼容标准接口，今天确认这个方向。", startMs: now - 20_000, endMs: now - 18_000, final: true },
    { id: "live-host-1", speakerId: "host-1", speakerName: "主持人", text: "同意，产品组明天补充接口文档，研发本周完成原型。", startMs: now - 10_000, endMs: now - 8_000, final: true },
  ];
  const raw = await requestMeetingSummary({
    provider: "mimo",
    protocol: "openai",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    model: "mimo-v2.5-pro",
    apiKey,
    segments,
  });
  const parsed = parseMeetingMinutesJson(raw);
  assert.ok(parsed, "MiMo response must parse as meeting minutes JSON");
  assert.ok(parsed.overview.length > 0, "structured response should include an overview");
  assert.ok(parsed.timeline.length > 0, "structured response should include the speaker timeline");
});
