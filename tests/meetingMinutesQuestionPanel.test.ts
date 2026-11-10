import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Window } from "happy-dom";
import {
  MAX_QUESTION_SOURCE_IDS,
  UNGROUNDED_ANSWER_ZH,
  resolveMeetingQuestionAnswer,
} from "../src/components/meeting/components/MeetingMinutesQuestionPanel";
import type { MeetingTranscriptSegment } from "../src/app/libs/meeting/meetingAi";

const includedIds = new Set(["seg-1", "seg-2", "seg-3"]);
const question = "刚才决定了什么？";

test("a confident answer without real source ids fails closed", () => {
  for (const raw of [
    JSON.stringify({ answer: "项目预算已经通过。", sourceIds: [] }),
    JSON.stringify({ answer: "项目预算已经通过。" }),
    `\`\`\`json\n${JSON.stringify({ answer: "项目预算已经通过。", sourceIds: [] })}\n\`\`\``,
  ]) {
    const answer = resolveMeetingQuestionAnswer(raw, includedIds, question, UNGROUNDED_ANSWER_ZH);
    assert.deepEqual(answer, { question, answer: UNGROUNDED_ANSWER_ZH, sourceIds: [] });
    assert.ok(!answer?.answer.includes("预算"), "the ungrounded assertion is not displayed");
  }
});

test("fabricated and unknown source ids never ground an answer", () => {
  const raw = JSON.stringify({ answer: "周五上线。", sourceIds: ["ghost-id", "seg-99", 7, null, { id: "seg-2" }] });
  const answer = resolveMeetingQuestionAnswer(raw, includedIds, question, UNGROUNDED_ANSWER_ZH);
  assert.deepEqual(answer, { question, answer: UNGROUNDED_ANSWER_ZH, sourceIds: [] });
  assert.ok(!answer?.answer.includes("周五"), "the fabricated assertion is not displayed");
});

test("valid source ids keep the original answer with only matching sources", () => {
  const raw = `\`\`\`json\n${JSON.stringify({ answer: "预算需要复核。", sourceIds: ["seg-2", "seg-2", "seg-1", "ghost-id"] })}\n\`\`\``;
  const answer = resolveMeetingQuestionAnswer(raw, includedIds, question, UNGROUNDED_ANSWER_ZH);
  assert.deepEqual(answer, { question, answer: "预算需要复核。", sourceIds: ["seg-2", "seg-1"] });
});

test("cited sources are deduplicated and capped", () => {
  const ids = new Set(Array.from({ length: 12 }, (_, index) => `seg-${index + 10}`));
  const answer = resolveMeetingQuestionAnswer(JSON.stringify({ answer: "可以确认。", sourceIds: [...ids, "seg-10"] }), ids, question, UNGROUNDED_ANSWER_ZH);
  assert.equal(answer?.sourceIds.length, MAX_QUESTION_SOURCE_IDS);
  assert.equal(new Set(answer?.sourceIds).size, MAX_QUESTION_SOURCE_IDS);
});

test("malformed model output is rejected instead of displayed", () => {
  assert.equal(resolveMeetingQuestionAnswer("not json", includedIds, question, UNGROUNDED_ANSWER_ZH), null);
  assert.equal(resolveMeetingQuestionAnswer(JSON.stringify({ sourceIds: ["seg-1"] }), includedIds, question, UNGROUNDED_ANSWER_ZH), null);
  assert.equal(resolveMeetingQuestionAnswer(JSON.stringify({ answer: "   ", sourceIds: ["seg-1"] }), includedIds, question, UNGROUNDED_ANSWER_ZH), null);
});

test("the panel never opens an unknown or fabricated source id", async () => {
  const browser = new Window({ url: "https://letshare.test" });
  for (const key of ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : key === "document" ? browser.document : key === "navigator" ? browser.navigator : true });
  }
  for (const key of ["HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: (browser as unknown as Record<string, unknown>)[key] });
  }
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: false, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });

  const { default: i18n } = await import("i18next");
  if (!i18n.isInitialized) {
    const { initReactI18next } = await import("react-i18next");
    await i18n.use(initReactI18next).init({ lng: "zh", fallbackLng: "zh", resources: { zh: { translation: {} } }, interpolation: { escapeValue: false }, initImmediate: false });
  }
  const { default: MeetingMinutesQuestionPanel } = await import("../src/components/meeting/components/MeetingMinutesQuestionPanel");
  const { createRoot } = await import("react-dom/client");

  const transcript: MeetingTranscriptSegment[] = [{ id: "seg-2", speakerId: "u1", speakerName: "成员", text: "预算需要复核。", startMs: 1, endMs: 2, final: true }];
  const opened: string[] = [];
  const container = browser.document.createElement("div") as unknown as HTMLElement;
  browser.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MeetingMinutesQuestionPanel, {
      transcript,
      onViewTranscript: (id: string) => opened.push(id),
      answers: [
        { question: "预算通过了吗？", answer: "预算已经通过。", sourceIds: ["ghost-id"] },
        { question: "预算怎么样了？", answer: "预算需要复核。", sourceIds: ["seg-2", "ghost-id"] },
      ],
      onAnswer: () => undefined,
    }));
  });

  const texts = [...container.querySelectorAll('[data-testid="meeting-ask-answer-text"]')].map((node) => node.textContent);
  assert.deepEqual(texts, [UNGROUNDED_ANSWER_ZH, "预算需要复核。"]);
  const sources = [...container.querySelectorAll<HTMLElement>('[data-testid="meeting-ask-source"]')];
  assert.equal(sources.length, 1, "only the recorded segment becomes a clickable source");
  assert.equal(sources[0]?.textContent, "查看原文 1");
  await act(async () => { sources[0]?.click(); });
  assert.deepEqual(opened, ["seg-2"]);
  const mayErr = [...container.querySelectorAll('[data-testid="meeting-ask-may-err"]')];
  assert.equal(mayErr.length, 1, "the AI-may-err note is only shown beside grounded answers");
  assert.equal(mayErr[0].textContent?.includes("可能出错"), true);

  await act(async () => { root.unmount(); });
  browser.close();
});
