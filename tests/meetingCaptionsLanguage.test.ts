import test from "node:test";
import assert from "node:assert/strict";
import { captionSourceLanguage, captionTranslationKey, resolveCaptionEngine } from "../src/app/libs/meeting/meetingCaptions";
import type { MeetingTranscriptSegment } from "../src/app/libs/meeting/meetingAi";

const segment: MeetingTranscriptSegment = { id: "one", speakerId: "a", speakerName: "A", text: "hello", startMs: 0, endMs: 0, final: true };

test("captions use each speaker's language instead of the viewer's preference", () => {
  assert.equal(captionSourceLanguage({ ...segment, language: "zh-CN", text: "hello" }), "en-US");
  assert.equal(captionSourceLanguage({ ...segment, language: "en-US", text: "中文" }), "zh-CN");
  assert.equal(captionSourceLanguage({ ...segment, language: "zh-CN", text: "A" }), "zh-CN");
  assert.equal(captionSourceLanguage({ ...segment, text: "中文" }), "zh-CN");
  assert.equal(captionSourceLanguage(segment), "en-US");
});

test("translation keys distinguish target language and arbitrary segment IDs", () => {
  assert.notEqual(captionTranslationKey("segment", "zh-CN"), captionTranslationKey("segment", "en-US"));
  assert.notEqual(captionTranslationKey('a", "b', "en-US"), captionTranslationKey("a", "en-US"));
});

test("an unconfigured server recognizer is surfaced, never silently switched", () => {
  assert.deepEqual(resolveCaptionEngine("server-stream", { stream: false, chunk: false, ai: false }), {
    engine: "server-stream", switched: false, note: "captionsEngineUnsupported",
  });
});

test("a configured server recognizer is left alone", () => {
  assert.deepEqual(resolveCaptionEngine("server-stream", { stream: true, chunk: false, ai: true }), {
    engine: "server-stream", switched: false, note: "",
  });
});
