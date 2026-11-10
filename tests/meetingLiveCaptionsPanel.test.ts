import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Window } from "happy-dom";
import type {
  CaptionEntry,
  MeetingLiveCaptionsPanelProps,
} from "../src/components/meeting/components/MeetingLiveCaptionsPanel";
import { captionPointerIntent } from "../src/components/meeting/meetingCaptionDrag";

type Harness = {
  browser: Window;
  render: (props: Partial<MeetingLiveCaptionsPanelProps>) => Promise<{
    browser: Window;
    container: HTMLElement;
    rerender: (element: React.ReactElement) => Promise<void>;
  }>;
  renderOverlay: (props: Partial<MeetingLiveCaptionsPanelProps>) => Promise<{
    browser: Window;
    container: HTMLElement;
  }>;
};

async function setupPanel(): Promise<Harness> {
  const browser = new Window({ url: "https://letshare.test" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  for (const key of ["HTMLElement", "Element", "Node", "SVGElement", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "PointerEvent", "MutationObserver", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: (browser as unknown as Record<string, unknown>)[key] });
  }

  const { default: i18n } = await import("i18next");
  if (!i18n.isInitialized) {
    const { initReactI18next } = await import("react-i18next");
    await i18n.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: { en: { translation: {} } },
      interpolation: { escapeValue: false },
      initImmediate: false,
    });
  }

  const { default: MeetingLiveCaptionsPanel, MeetingCaptionOverlay } = await import("../src/components/meeting/components/MeetingLiveCaptionsPanel");
  const { createRoot } = await import("react-dom/client");

  const base = (props: Partial<MeetingLiveCaptionsPanelProps>): MeetingLiveCaptionsPanelProps => ({
    open: true,
    active: false,
    entries: [],
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    transcriptAvailable: true,
    onToggleActive: () => undefined,
    onClose: () => undefined,
    onSourceLanguageChange: () => undefined,
    onTargetLanguageChange: () => undefined,
    onViewTranscript: () => undefined,
    ...props,
  });

  const mount = async (element: React.ReactElement) => {
    const container = browser.document.createElement("div") as unknown as HTMLElement;
    browser.document.body.appendChild(container);
    const root = createRoot(container);
    const rerender = async (next: React.ReactElement) => {
      await act(async () => { root.render(next); });
    };
    await rerender(element);
    return { browser, container, rerender };
  };
  const mountStatic = async (element: React.ReactElement) => {
    const container = browser.document.createElement("div") as unknown as HTMLElement;
    browser.document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(element); });
    return { browser, container };
  };

  return {
    browser,
    render: (props) => mount(React.createElement(MeetingLiveCaptionsPanel, base(props))),
    renderOverlay: (props) => mountStatic(React.createElement(MeetingCaptionOverlay, base(props))),
  };
}

const pendingEntry: CaptionEntry = {
  id: "seg-1",
  speakerName: "Ana",
  text: "我们先确认预算。",
  startMs: 65_000,
  translationState: "pending",
};

function click(browser: Window, element: HTMLElement) {
  return act(async () => {
    element.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function openHistory(browser: Window, container: HTMLElement) {
  const toggle = container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-history-toggle"]')!;
  assert.ok(toggle, "history toggle renders in the control bar");
  await click(browser, toggle);
}

test("cinema overlay shows the latest line with a hover-revealed black plate", async () => {
  const { renderOverlay } = await setupPanel();
  const { container } = await renderOverlay({
    active: true,
    targetLanguage: "zh-CN",
    entries: [
      { ...pendingEntry, id: "seg-old", text: "旧的一句", translationState: "ready", translatedText: "An older line" },
      { ...pendingEntry, id: "seg-new", text: "Let's confirm the budget first.", language: "en-US", translationState: "ready", translatedText: "我们先确认预算。" },
    ],
  });
  const overlay = container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-overlay"]')!;
  assert.ok(overlay, "overlay renders while captions are active");
  assert.equal(overlay.getAttribute("data-caption-surface"), "cinema");
  assert.equal(overlay.getAttribute("data-caption-reveal"), "hover", "the black plate only appears on hover/focus");
  assert.ok(!container.textContent?.includes("旧的一句"), "only the newest line is shown, like film subtitles");
  assert.ok(container.textContent?.includes("Let's confirm the budget first."));
  assert.equal(
    container.querySelector('[data-testid="meeting-live-captions-overlay-translation"]')?.textContent,
    "我们先确认预算。",
    "English speech is translated for a Chinese viewer",
  );
});

test("cinema overlay stays quiet when nothing was said and disappears when closed", async () => {
  const { renderOverlay } = await setupPanel();
  const waiting = await renderOverlay({ active: true, entries: [] });
  assert.ok(waiting.container.textContent?.includes("Waiting for speech"));
  const idle = await renderOverlay({ active: false, entries: [] });
  assert.equal(idle.container.querySelector('[data-testid="meeting-live-captions-overlay"]'), null);
});

test("mixed-language speakers use their own source language and unavailable history is not clickable", async () => {
  const { browser, render } = await setupPanel();
  const { container } = await render({
    sourceLanguage: "zh-CN",
    targetLanguage: "zh-CN",
    transcriptAvailable: true,
    entries: [{ ...pendingEntry, language: "en-US", text: "Hello", translatedText: "你好", translationState: "ready", transcriptAvailable: false }],
  });
  await openHistory(browser, container);
  assert.ok(container.textContent?.includes("你好"), "English speaker should be translated for a Chinese viewer");
  assert.notEqual(container.querySelector('[data-testid="meeting-live-captions-entry"]')?.tagName, "BUTTON", "caption-only history has no fabricated transcript target");
});

test("control bar keeps caption control separate from closing", async () => {
  const { render } = await setupPanel();
  const calls = { toggle: 0, close: 0 };
  const { browser, container } = await render({
    active: true,
    entries: [pendingEntry],
    onToggleActive: () => { calls.toggle += 1; },
    onClose: () => { calls.close += 1; },
  });

  const bar = container.querySelector('[data-testid="meeting-live-captions-panel"]')!;
  assert.ok(bar, "control bar renders while open");
  assert.equal(bar.getAttribute("data-active"), "true");
  assert.ok(container.textContent?.includes("Live captions"));
  assert.equal(container.querySelector('[data-testid="meeting-live-captions-status"]')?.textContent, "On");

  const close = container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-close"]')!;
  assert.equal(close.getAttribute("aria-label"), "Close controls, captions keep running");
  await click(browser, close);
  assert.equal(calls.close, 1);
  assert.equal(calls.toggle, 0, "closing the bar must not toggle caption recording");

  const toggle = container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-toggle"]')!;
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  await click(browser, toggle);
  assert.equal(calls.toggle, 1, "the dedicated control toggles captions");

  assert.ok(container.querySelector('[data-testid="meeting-live-captions-announcer"]'), "live region is present");
});

test("history renders original, pending and error translations", async () => {
  const { browser, render } = await setupPanel();
  const { container } = await render({
    entries: [pendingEntry, { ...pendingEntry, id: "seg-2", translationState: "error" }],
    error: "Translation service unavailable",
  });

  const errorChip = container.querySelector('[data-testid="meeting-live-captions-error"]');
  assert.ok(errorChip, "translation errors surface without hiding captions");
  assert.ok(errorChip?.textContent?.includes("Translation service unavailable"));

  await openHistory(browser, container);
  const entries = container.querySelectorAll('[data-testid="meeting-live-captions-entry"]');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].getAttribute("data-segment-id"), "seg-1");
  assert.ok(container.querySelector('[data-testid="meeting-live-captions-translation-pending"]'));
  assert.ok(container.querySelector('[data-testid="meeting-live-captions-translation-error"]'));
  assert.ok(container.textContent?.includes("我们先确认预算。"), "original text stays visible");
  assert.ok(container.textContent?.includes("Translating…"));
  assert.ok(container.textContent?.includes("Translation unavailable"));

  const history = container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-history"]')!;
  assert.equal(history.getAttribute("role"), "region");
  assert.equal(history.tabIndex, 0, "keyboard users can focus and scroll the history");
  assert.equal(history.getAttribute("aria-label"), "Live caption history");
});

test("transcript navigation only fires when the notes original is available", async () => {
  const { render } = await setupPanel();
  const clicked: string[] = [];
  const entry: CaptionEntry = { ...pendingEntry, id: "seg-9", translationState: "ready", translatedText: "Let's confirm the budget first." };

  const available = await render({
    entries: [entry],
    transcriptAvailable: true,
    onViewTranscript: (id) => { clicked.push(id); },
  });
  await openHistory(available.browser, available.container);
  const availableEntry = available.container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-entry"]')!;
  assert.equal(availableEntry.tagName, "BUTTON");
  assert.ok(availableEntry.getAttribute("aria-describedby"), "the row describes the transcript action for assistive tech");
  await click(available.browser, availableEntry);
  assert.deepEqual(clicked, ["seg-9"], "the stable segment id is forwarded");
  assert.ok(available.container.textContent?.includes("Let's confirm the budget first."));

  const unavailable = await render({
    entries: [entry],
    transcriptAvailable: false,
    onViewTranscript: (id) => { clicked.push(id); },
  });
  await openHistory(unavailable.browser, unavailable.container);
  const blockedEntry = unavailable.container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-entry"]')!;
  assert.equal(blockedEntry.tagName, "DIV");
  assert.equal(blockedEntry.getAttribute("data-transcript-available"), "false");
  assert.ok(unavailable.container.querySelector('[data-testid="meeting-live-captions-transcript-unavailable"]'));
  await click(unavailable.browser, blockedEntry);
  assert.deepEqual(clicked, ["seg-9"], "unavailable notes never call the navigation callback");
});

test("control bar hides stale translations when display language matches the source", async () => {
  const { renderOverlay } = await setupPanel();
  const entry: CaptionEntry = { ...pendingEntry, id: "seg-3", translationState: "ready", translatedText: "Let's confirm the budget first." };
  const stale = await renderOverlay({ entries: [entry], sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  assert.ok(stale.container.textContent?.includes("Let's confirm the budget first."));
  assert.equal(stale.container.querySelector('[data-testid="meeting-live-captions-same-language"]'), null);

  const same = await renderOverlay({ entries: [entry], sourceLanguage: "zh-CN", targetLanguage: "zh-CN" });
  assert.ok(!same.container.textContent?.includes("Let's confirm the budget first."), "same-language display never shows an outdated translation");
  assert.ok(same.container.textContent?.includes("我们先确认预算。"), "the original still renders");
});

test("control bar exposes labelled controls and explains matching languages", async () => {
  const { render } = await setupPanel();
  const { browser, container } = await render({ active: false, sourceLanguage: "zh-CN", targetLanguage: "zh-CN" });
  const bar = container.querySelector('[data-testid="meeting-live-captions-panel"]')!;
  const labelledBy = bar.getAttribute("aria-labelledby");
  assert.ok(labelledBy, "the bar region is labelled");
  assert.equal(browser.document.getElementById(labelledBy!)?.textContent, "Live captions");

  assert.ok(container.querySelector('[data-testid="meeting-live-captions-same-language"]')?.textContent?.includes("Your spoken and display languages match"));

  const close = container.querySelector('[data-testid="meeting-live-captions-close"]')!;
  assert.equal(close.getAttribute("aria-label"), "Close caption controls");

  const toggle = container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-toggle"]')!;
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.getAttribute("aria-label"), "Start captions", "the toggle is an icon-only button with an accessible name");
  assert.equal(container.querySelector('[data-testid="meeting-live-captions-status"]')?.textContent, "Off");

  for (const [testId, label] of [["meeting-live-captions-source-language", "My spoken language"], ["meeting-live-captions-target-language", "Display language"]] as const) {
    const select = container.querySelector(`[data-testid="${testId}"]`)!;
    assert.ok(select, `${testId} renders`);
    const combobox = select.querySelector("[role=\"combobox\"]")!;
    const ids = (combobox.getAttribute("aria-labelledby") || "").split(" ").filter(Boolean);
    assert.ok(ids.some((id) => browser.document.getElementById(id)?.textContent === label), `${testId} is labelled ${label}`);
  }
});

test("opening a language menu never starts a caption-bar drag", async () => {
  const { render } = await setupPanel();
  const { browser, container } = await render({ active: true });
  const bar = container.querySelector('[data-testid="meeting-live-captions-panel"]')!;
  const select = container.querySelector('[data-testid="meeting-live-captions-source-language"]')!;
  assert.equal(captionPointerIntent(bar, select.querySelector("svg")), "control", "the dropdown arrow belongs to the select");
  assert.equal(captionPointerIntent(bar, select.querySelector("[role=\"combobox\"]")), "control", "the select trigger belongs to the select");
  assert.equal(captionPointerIntent(bar, container.querySelector('[data-testid="meeting-live-captions-close"]')), "control", "the close button keeps its click");
  assert.equal(captionPointerIntent(bar, bar), "surface", "the bar body still drags");
  const grip = container.querySelector('[data-caption-drag-handle="true"]')!;
  assert.equal(captionPointerIntent(bar, grip), "drag-handle", "the grip remains the explicit drag affordance");
  // A portal child (language menu / its backdrop) is not inside the bar's DOM.
  const portalNode = browser.document.createElement("div");
  browser.document.body.appendChild(portalNode);
  assert.equal(captionPointerIntent(bar, portalNode), "outside", "portalled menu clicks never start a drag");
});

test("the control bar can be dragged with the keyboard", async () => {
  const { render } = await setupPanel();
  const { browser, container } = await render({ active: false });
  const bar = container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-panel"]')!;
  const drag = container.querySelector<HTMLElement>('[data-testid="meeting-live-captions-drag"]')!;
  assert.equal(drag.getAttribute("role"), "button");
  assert.equal(drag.tabIndex, 0);
  assert.match(drag.getAttribute("aria-keyshortcuts") || "", /ArrowLeft/);
  assert.equal(drag.getAttribute("aria-label"), "Move caption controls");

  Object.defineProperty(container, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600, x: 0, y: 0 }) });
  Object.defineProperty(bar, "getBoundingClientRect", { value: () => ({ left: 16, top: 54, width: 520, height: 52, right: 536, bottom: 106, x: 16, y: 54 }) });

  await act(async () => { drag.dispatchEvent(new browser.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })); });
  assert.equal(bar.style.left, "32px", "ArrowRight nudges the floating control bar");
  await act(async () => { drag.dispatchEvent(new browser.KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })); });
  assert.equal(bar.style.top, "70px", "ArrowDown nudges the floating control bar");
});

test("control bar renders nothing while closed", async () => {
  const { render } = await setupPanel();
  const { container } = await render({ open: false, entries: [pendingEntry] });
  assert.equal(container.querySelector('[data-testid="meeting-live-captions-panel"]'), null);
});
