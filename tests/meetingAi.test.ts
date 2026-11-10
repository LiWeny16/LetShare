import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MEETING_AI_CONFIG,
  DEFAULT_MEMBER_MEETING_AI_PREFERENCES,
  EXPECTED_MEETING_AI_ASR_PROVIDER,
  EXPECTED_MEETING_AI_SUMMARY_MODEL,
  EXPECTED_MEETING_AI_SUMMARY_PROVIDER,
  MEETING_AI_ASSISTANT_ID,
  canSendMeetingMinutesSegment,
  canStartCaptionOnlyCapture,
  hasSharedMeetingMinutesCapability,
  isValidMeetingMinutesSummaryPayload,
  getMemberMeetingAiPreferences,
  getMeetingMinutesNoticeKey,
  mergeMeetingMinutesTimeline,
  parseMeetingMinutesJson,
  saveMemberMeetingAiSettings,
  sanitizeMeetingAiConfig,
  shouldShowMeetingMinutesNotice,
  setMemberMeetingAiPreferences,
  ServerStreamAsrSession,
} from "../src/app/libs/meeting/meetingAi";

test("AI 会议配置只保留服务端流式识别，历史偏好一律归一", () => {
  const legacy = sanitizeMeetingAiConfig({
    enabled: true,
    language: "en-US",
    // Historical local-engine values must never survive normalization.
    asrSource: "browser-speech" as never,
    asrModel: "tiny",
    // Legacy BYOK provider settings are ignored by the server-backed client.
    summaryProvider: "mimo",
    summaryModel: "mimo-v2.5-pro",
    summaryBaseUrl: "https://obsolete.invalid/v1",
  } as never);
  assert.deepEqual(legacy, { enabled: true, requireConsent: false, language: "en-US", asrSource: "server-stream", asrModel: "server-asr" });
  const wasm = sanitizeMeetingAiConfig({ asrSource: "wasm" as never, asrModel: "small" });
  assert.equal(wasm.asrSource, "server-stream");
  assert.equal(wasm.asrModel, "server-asr");
  assert.equal(wasm.enabled, false);
  assert.equal(DEFAULT_MEETING_AI_CONFIG.requireConsent, false);
  assert.equal(DEFAULT_MEETING_AI_CONFIG.asrSource, "server-stream");
});

test("minutes notice is shown to late joiners once for each active recording epoch", () => {
  const capabilities = { capabilitiesKnown: true, serverMix: true, ai: true } as const;
  const lateJoinSnapshot = { ...capabilities, running: true, recordingId: "recording-2", consented: false };
  const activeKey = getMeetingMinutesNoticeKey(lateJoinSnapshot, "1234");
  assert.equal(activeKey, "recording-2");
  assert.equal(shouldShowMeetingMinutesNotice(activeKey, ""), true, "an active snapshot must show the notice without prior consent");
  assert.equal(shouldShowMeetingMinutesNotice(activeKey, activeKey), false, "acknowledgement hides this recording's notice");
  const nextRecordingKey = getMeetingMinutesNoticeKey({ ...capabilities, running: true, recordingId: "recording-3", consented: false }, "1234");
  assert.equal(shouldShowMeetingMinutesNotice(nextRecordingKey, activeKey), true, "a new recording gets a new notice");
  assert.equal(getMeetingMinutesNoticeKey({ ...capabilities, running: false, recordingId: "recording-3" }, "1234"), "");
  assert.equal(getMeetingMinutesNoticeKey({ capabilitiesKnown: false, running: true }, "1234"), "", "old servers without a capability handshake do not show a false recording notice");
  assert.equal(getMeetingMinutesNoticeKey({ ...capabilities, running: true }, "1234"), "1234:active");
  assert.equal(getMeetingMinutesNoticeKey({ ...capabilities, ai: false, running: true, recordingId: "recording-asr-only" }, "1234"), "recording-asr-only", "a confirmed active audio mix still notifies members even without summary capability");
});

test("shared minutes require explicit server capabilities and summary payloads are never byte-sliced", () => {
  assert.equal(hasSharedMeetingMinutesCapability({ capabilitiesKnown: false, serverMix: true, ai: true }), false);
  assert.equal(hasSharedMeetingMinutesCapability({ capabilitiesKnown: true, serverMix: false, ai: true }), false);
  assert.equal(hasSharedMeetingMinutesCapability({ capabilitiesKnown: true, serverMix: true, ai: false }), false);
  assert.equal(hasSharedMeetingMinutesCapability({ capabilitiesKnown: true, serverMix: true, ai: true }), true);

  const chinese = JSON.stringify({ overview: "摘要" });
  assert.equal(isValidMeetingMinutesSummaryPayload(chinese, new TextEncoder().encode(chinese).length), true);
  assert.equal(isValidMeetingMinutesSummaryPayload(chinese, new TextEncoder().encode(chinese).length - 1), false, "UTF-8 bytes, not JS character count, determine the limit");
  assert.equal(isValidMeetingMinutesSummaryPayload('{"overview":"broken"', 1024), false, "partial JSON is never sent");
});

test("mixed minutes do not require consent while per-speaker ASR remains caption-only", () => {
  assert.equal(canStartCaptionOnlyCapture({ running: true, captionActive: true, consented: true }), false);
  assert.equal(canStartCaptionOnlyCapture({ running: true, captionActive: false, consented: true }), false);
  assert.equal(canStartCaptionOnlyCapture({ running: false, captionActive: true, consented: true }), true);
  assert.equal(canStartCaptionOnlyCapture({ running: false, captionActive: true, consented: false }), false);
  assert.equal(canSendMeetingMinutesSegment({ running: true, captionActive: false, consented: false }), true);
  assert.equal(canSendMeetingMinutesSegment({ running: false, captionActive: true, consented: false }), false);
});

test("partial member preference updates preserve opt-out and normalize to server streaming", () => {
  assert.deepEqual(DEFAULT_MEMBER_MEETING_AI_PREFERENCES, { enabled: true, language: "zh-CN", asrSource: "server-stream", asrModel: "server-asr" });
  setMemberMeetingAiPreferences({ enabled: false });
  const languageOnlyUpdate = setMemberMeetingAiPreferences({ language: "en-US", asrSource: "iflytek" as never, asrModel: "iflytek-realtime" });
  assert.equal(languageOnlyUpdate.enabled, false, "a language-only update must preserve the member's opt-out");
  assert.equal(languageOnlyUpdate.language, "en-US");
  assert.equal(languageOnlyUpdate.asrSource, "server-stream");
  assert.deepEqual(getMemberMeetingAiPreferences(), { enabled: false, language: "en-US", asrSource: "server-stream", asrModel: "server-asr" });
  setMemberMeetingAiPreferences(DEFAULT_MEMBER_MEETING_AI_PREFERENCES);
  assert.equal(getMemberMeetingAiPreferences().enabled, true);
});

test("saving member settings persists its selected subtitle language", () => {
  setMemberMeetingAiPreferences({ enabled: false, language: "zh-CN" });
  const saved = saveMemberMeetingAiSettings("en-US");
  assert.equal(saved.language, "en-US");
  assert.equal(saved.enabled, false, "saving a language must not opt the member back in");
  assert.deepEqual(getMemberMeetingAiPreferences(), saved);
  setMemberMeetingAiPreferences(DEFAULT_MEMBER_MEETING_AI_PREFERENCES);
});

test("meeting AI provider constants describe expected backend services", () => {
  assert.equal(EXPECTED_MEETING_AI_ASR_PROVIDER, "Somni");
  assert.equal(EXPECTED_MEETING_AI_SUMMARY_PROVIDER, "Gemini");
  assert.equal(EXPECTED_MEETING_AI_SUMMARY_MODEL, "gemini-3.5-flash-lite");
});

test("the reserved assistant identity is stable", () => {
  assert.equal(MEETING_AI_ASSISTANT_ID, "ai:meeting-assistant");
});

test("parseMeetingMinutesJson tolerates fenced JSON and normalizes timeline kinds", () => {
  const parsed = parseMeetingMinutesJson('```json\n' + JSON.stringify({
    meetingTitle: "评审",
    overview: "结论摘要",
    timeline: [
      { id: "t1", startMs: 1, endMs: 2, speakerName: "Alice", summary: "讨论", kind: "weird" },
      { startMs: 5, speakerName: "Bob", transcript: "决定上线", kind: "decision" },
    ],
    decisions: [{ text: "上线", timeMs: 5 }],
    actionItems: [{ task: "发布", owner: "Bob" }],
    openQuestions: [{ question: "回滚方案" }],
  }) + "\n```");
  assert.equal(parsed?.meetingTitle, "评审");
  assert.equal(parsed?.overview, "结论摘要");
  assert.equal(parsed?.timeline.length, 2);
  assert.equal(parsed?.timeline[0].kind, "speech", "unknown kinds fall back to speech");
  assert.equal(parsed?.timeline[1].kind, "decision");
  assert.equal(parsed?.timeline[1].id, "timeline-2");
  assert.equal(parsed?.decisions[0].text, "上线");
  assert.equal(parsed?.actionItems[0].owner, "Bob");
  assert.equal(parseMeetingMinutesJson("not json"), null);
  assert.equal(parseMeetingMinutesJson(""), null);
  assert.equal(parseMeetingMinutesJson(JSON.stringify({ contextTruncated: true }))?.contextTruncated, true, "shared compaction warnings survive recipient parsing");
});

test("shared timeline keeps distinct events when model IDs are missing or reused", () => {
  const first = {
    id: "timeline-1", startMs: 1_000, endMs: 1_400, speakerName: "Mina",
    summary: "Design option A", transcript: "We will review option A", kind: "speech" as const,
  };
  const second = {
    ...first, startMs: 2_000, endMs: 2_500, summary: "Design option B", transcript: "We will review option B",
  };
  const firstMerge = mergeMeetingMinutesTimeline([], [first]);
  const secondMerge = mergeMeetingMinutesTimeline(firstMerge, [second]);
  const repeatedMerge = mergeMeetingMinutesTimeline(secondMerge, [second]);

  assert.equal(secondMerge.length, 2, "a reused generated ID must append a different event");
  assert.equal(repeatedMerge.length, 2, "a repeated event with the same time, speaker, and content must deduplicate");
  assert.equal(repeatedMerge[0].transcript, first.transcript, "the earlier node must remain unchanged");
  assert.equal(repeatedMerge[1].transcript, second.transcript);
  assert.notEqual(repeatedMerge[0].id, repeatedMerge[1].id);
  assert.ok(repeatedMerge.every((item) => item.id && !/^timeline-\d+$/.test(item.id)), "unstable model IDs are replaced with stable content IDs");

  const noIdFirst = { ...first, id: "" };
  const noIdSecond = { ...second, id: "" };
  const noIdMerge = mergeMeetingMinutesTimeline([], [noIdFirst, noIdSecond]);
  assert.equal(noIdMerge.length, 2, "different events without model IDs remain separate");
  assert.equal(mergeMeetingMinutesTimeline(noIdMerge, [noIdFirst, noIdSecond]).length, 2, "the same no-ID events deduplicate across responses");
});

test("ServerStreamAsrSession reports an error instead of starting without a microphone", async () => {
  const errors: string[] = [];
  const session = new ServerStreamAsrSession({
    language: "zh-CN",
    onStart: () => assert.fail("must not start without mediaDevices"),
    onAudio: () => undefined,
    onStop: () => undefined,
    onError: (message) => errors.push(message),
  });
  const started = await session.start();
  assert.equal(started, false);
  assert.equal(errors.length, 1);
  assert.equal(session.isRunning(), false);
  session.stop();
});
