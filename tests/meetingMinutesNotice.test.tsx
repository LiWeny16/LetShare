import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Window } from "happy-dom";

test("minutes notice has one acknowledgement and member settings have no opt-out", async () => {
  const browser = new Window({ url: "https://letshare.test" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  for (const key of ["HTMLElement", "Element", "Node", "DocumentFragment", "SVGElement", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: (browser as unknown as Record<string, unknown>)[key] });
  }
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: false, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });

  const { default: i18n } = await import("i18next");
  if (!i18n.isInitialized) {
    const { initReactI18next } = await import("react-i18next");
    await i18n.use(initReactI18next).init({ lng: "zh", fallbackLng: "zh", resources: { zh: { translation: {} } }, interpolation: { escapeValue: false }, initImmediate: false });
  }
  const { default: MeetingMinutesNoticeDialog } = await import("../src/components/meeting/components/MeetingMinutesNoticeDialog");
  const { default: MeetingAiSettingsView } = await import("../src/components/meeting/components/MeetingAiSettingsView");
  const { createRoot } = await import("react-dom/client");

  const container = browser.document.createElement("div") as unknown as HTMLElement;
  browser.document.body.appendChild(container);
  const root = createRoot(container);
  let acknowledgements = 0;
  try {
    await act(async () => {
      root.render(React.createElement(MeetingMinutesNoticeDialog, {
        open: true,
        onAcknowledge: () => { acknowledgements += 1; },
      }));
    });
    const notice = browser.document.body.querySelector('[data-testid="meeting-minutes-notice-dialog"]');
    assert.ok(notice, "a late joiner sees the active recording notice even with no consent state");
    const buttons = [...notice.querySelectorAll("button")];
    assert.equal(buttons.length, 1, "the mixed-minutes notice has one acknowledgement action");
    assert.equal(buttons[0].getAttribute("data-testid"), "meeting-minutes-notice-acknowledge");
    assert.ok(notice.textContent?.includes("有成员开启了 AI 会议纪要"), "the notice explains that any member can start shared minutes");
    await act(async () => {
      buttons[0].dispatchEvent(new browser.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    assert.equal(acknowledgements, 1, "the sole action only acknowledges the local notice");

    await act(async () => {
      root.render(React.createElement(MeetingAiSettingsView, {
        config: { enabled: false, requireConsent: false, language: "zh-CN", asrSource: "server-stream", asrModel: "server-asr" },
        onBack: () => undefined,
        onSave: () => undefined,
        onUpdateConfig: () => undefined,
      }));
    });
    assert.equal(container.querySelectorAll('input[type="checkbox"]').length, 0, "members have no minutes opt-out switch");
    assert.ok(container.textContent?.includes("任何成员都可以开启共享 AI 会议纪要"), "any member can start shared minutes");
    assert.equal(container.querySelector('[aria-label="个人字幕语言偏好"]'), null, "disabled captions have no member settings control");
    assert.equal(container.textContent?.includes("字幕"), false, "disabled captions are not promoted in minutes settings");

    await act(async () => {
      root.render(React.createElement(MeetingAiSettingsView, {
        config: { enabled: true, requireConsent: false, language: "zh-CN", asrSource: "server-stream", asrModel: "server-asr" },
        onBack: () => undefined,
        onSave: () => undefined,
        onUpdateConfig: () => undefined,
      }));
    });
    assert.equal(container.querySelectorAll('input[type="checkbox"]').length, 0, "the host has no second settings switch that is ignored on save");
    assert.ok(container.querySelector('[role="radiogroup"][aria-label="纪要生成语言"]'), "the host can choose the minutes output language");
  } finally {
    await act(async () => { root.unmount(); });
    browser.close();
  }
});
