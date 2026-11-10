import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18next from "i18next";
import { resources } from "../src/app/libs/i18n/translation";
import { DEFAULT_MEETING_AI_CONFIG } from "../src/app/libs/meeting/meetingAi";
import MeetingAiSettingsView from "../src/components/meeting/components/MeetingAiSettingsView";

test("meeting assistant settings use the active app language for every static label", async () => {
  await i18next.init({ resources, lng: "en", fallbackLng: "en", interpolation: { escapeValue: false } });
  const props = {
    config: { ...DEFAULT_MEETING_AI_CONFIG },
    onBack: () => undefined,
    onSave: () => undefined,
    onUpdateConfig: () => undefined,
  };

  const english = renderToStaticMarkup(React.createElement(MeetingAiSettingsView, props));
  assert.match(english, /Meeting assistant/);
  assert.match(english, /Expected services: Somni transcription · Gemini summary/);
  assert.match(english, /Summary language/);
  assert.match(english, /The meeting server provides transcription and summaries/);
  assert.doesNotMatch(english, /会议助理|纪要生成语言|保存中/);

  await i18next.changeLanguage("zh");
  const chinese = renderToStaticMarkup(React.createElement(MeetingAiSettingsView, props));
  assert.match(chinese, /会议助理/);
  assert.match(chinese, /预期服务：Somni 转写 · Gemini 摘要/);
  assert.match(chinese, /纪要生成语言/);
  assert.ok(chinese.includes("选择本次共享摘要的语言。首次开启纪要的成员会为整场录制确定语言，录制开始后不能更改。"));
  assert.doesNotMatch(chinese, /Meeting assistant|Summary language|Expected services/);

  await i18next.changeLanguage("en");
  const participant = renderToStaticMarkup(React.createElement(MeetingAiSettingsView, { ...props }));
  assert.match(participant, /role="radiogroup"/, "every member can choose the shared summary language");
  assert.match(participant, />Save</, "every member can save their next-session preference");
  const fixedLanguage = renderToStaticMarkup(React.createElement(MeetingAiSettingsView, { ...props, recordingRunning: true }));
  assert.match(fixedLanguage, /aria-disabled="true"/, "the active recording language is fixed for all members");
  assert.ok(fixedLanguage.includes('disabled=""'), "members cannot save a different language during the active recording");
});
