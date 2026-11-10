import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { act } from "react";
import { Window } from "happy-dom";
import type { MeetingMinutesWorkspaceProps } from "../src/components/meeting/components/MeetingMinutesWorkspace";
import type { MeetingTranscriptSegment } from "../src/app/libs/meeting/meetingAi";

type ScrollCall = { node: HTMLElement; options: ScrollIntoViewOptions | undefined };

type Harness = {
  browser: Window;
  scrollCalls: ScrollCall[];
  render: (props: Partial<MeetingMinutesWorkspaceProps>) => Promise<{
    container: HTMLElement;
    update: (props: Partial<MeetingMinutesWorkspaceProps>) => Promise<void>;
  }>;
};

const transcript: MeetingTranscriptSegment[] = [
  { id: "seg-1", speakerId: "u1", speakerName: "Ana", text: "We start with the budget.", startMs: 5_000, endMs: 9_000, final: true },
  { id: "seg-2", speakerId: "u2", speakerName: "Bo", text: "The budget needs a second review.", startMs: 12_000, endMs: 18_000, final: true },
  { id: "seg-3", speakerId: "u1", speakerName: "Ana", text: "I will send the numbers tomorrow.", startMs: 20_000, endMs: 25_000, final: true },
];

async function setupWorkspace(options: { reducedMotion?: boolean } = {}): Promise<Harness> {
  const browser = new Window({ url: "https://letshare.test" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  for (const key of ["HTMLElement", "Element", "Node", "SVGElement", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: (browser as unknown as Record<string, unknown>)[key] });
  }
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: Boolean(options.reducedMotion) && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(browser, "matchMedia", { configurable: true, value: (globalThis as unknown as { matchMedia: (query: string) => unknown }).matchMedia });

  const scrollCalls: ScrollCall[] = [];
  (browser.HTMLElement.prototype as unknown as { scrollIntoView: (options?: ScrollIntoViewOptions) => void }).scrollIntoView = function scrollIntoView(this: HTMLElement, scrollOptions?: ScrollIntoViewOptions) {
    scrollCalls.push({ node: this, options: scrollOptions });
  };

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

  const { default: MeetingMinutesWorkspace } = await import("../src/components/meeting/components/MeetingMinutesWorkspace");
  const { createRoot } = await import("react-dom/client");

  const render = async (props: Partial<MeetingMinutesWorkspaceProps>) => {
    const container = browser.document.createElement("div") as unknown as HTMLElement;
    browser.document.body.appendChild(container);
    const root = createRoot(container);
    let current: MeetingMinutesWorkspaceProps = {
      open: true,
      onClose: () => undefined,
      summary: "",
      summaryData: null,
      timeline: [],
      transcript,
      tab: 1,
      onTabChange: () => undefined,
      onExport: () => undefined,
      ...props,
    };
    const update = async (next: Partial<MeetingMinutesWorkspaceProps>) => {
      current = { ...current, ...next };
      await act(async () => { root.render(React.createElement(MeetingMinutesWorkspace, current)); });
    };
    await update({});
    return { container, update };
  };

  return { browser, scrollCalls, render };
}

function row(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-segment-id="${id}"]`);
}

test("workspace reveals the requested transcript segment", async () => {
  const { render, scrollCalls, browser } = await setupWorkspace();
  const { container } = await render({ tab: 1, focusSegmentId: "seg-2" });

  const target = row(container, "seg-2");
  assert.ok(target, "the transcript row is tagged with its stable segment id");
  assert.equal(target.getAttribute("aria-current"), "true");
  assert.equal(target.getAttribute("tabindex"), "-1", "the row is focusable but stays out of the tab order");
  assert.equal(scrollCalls.length, 1, "the requested segment is scrolled into view exactly once");
  assert.equal(scrollCalls[0].node, target);
  assert.equal(scrollCalls[0].options?.block, "center");
  assert.equal(scrollCalls[0].options?.behavior, "smooth");
  assert.equal(browser.document.activeElement, target, "keyboard and screen-reader focus move to the revealed line");
  assert.equal(row(container, "seg-1")?.getAttribute("aria-current"), null);
  assert.equal(row(container, "seg-3")?.getAttribute("aria-current"), null);
});

test("changing the focused segment moves the reveal to the new line", async () => {
  const { render, scrollCalls, browser } = await setupWorkspace();
  const { container, update } = await render({ tab: 1, focusSegmentId: "seg-1" });
  assert.equal(scrollCalls.at(-1)?.node, row(container, "seg-1"));

  await update({ focusSegmentId: "seg-3" });
  const next = row(container, "seg-3");
  assert.ok(next);
  assert.equal(scrollCalls.length, 2, "a new segment id triggers a new reveal");
  assert.equal(scrollCalls.at(-1)?.node, next);
  assert.equal(next.getAttribute("aria-current"), "true");
  assert.equal(row(container, "seg-1")?.getAttribute("aria-current"), null, "the previous highlight is cleared");
  assert.equal(browser.document.activeElement, next);
});

test("an unknown segment id never invents a match", async () => {
  const { render, scrollCalls } = await setupWorkspace();
  const { container, update } = await render({ tab: 1, focusSegmentId: "seg-absent" });
  assert.equal(scrollCalls.length, 0, "no DOM lookup or scroll happens for an unmatched id");
  assert.equal(container.querySelectorAll("[aria-current]").length, 0);
  assert.equal(container.querySelectorAll("[data-segment-id]").length, transcript.length, "rows stay tagged with real ids only");

  await update({ focusSegmentId: "seg-2" });
  assert.equal(scrollCalls.length, 1, "a valid id received later is still revealed");
  assert.equal(row(container, "seg-2")?.getAttribute("aria-current"), "true");

  await update({ focusSegmentId: "seg-missing-again" });
  assert.equal(scrollCalls.length, 1, "a missing id after a valid one reveals nothing");
  assert.equal(container.querySelectorAll("[aria-current]").length, 0);
});

test("reveal waits for the transcript tab and ignores other tabs", async () => {
  const { render, scrollCalls } = await setupWorkspace();
  const { container, update } = await render({ tab: 0, focusSegmentId: "seg-2" });
  assert.equal(container.querySelectorAll("[data-segment-id]").length, 0, "other tabs render no transcript rows");
  assert.equal(scrollCalls.length, 0);

  await update({ tab: 1 });
  assert.equal(scrollCalls.length, 1);
  assert.equal(scrollCalls.at(-1)?.node, row(container, "seg-2"));

  await update({ tab: 2 });
  await update({ tab: 1 });
  assert.equal(scrollCalls.length, 2, "returning to the transcript re-reveals the focused line");
});

test("workspace keeps existing behaviour without a focus request", async () => {
  const { render, scrollCalls } = await setupWorkspace();
  const { container } = await render({ tab: 1 });
  assert.equal(scrollCalls.length, 0);
  assert.equal(container.querySelectorAll("[aria-current]").length, 0);
  assert.equal(container.querySelectorAll("[data-segment-id]").length, transcript.length);
  assert.equal(container.textContent?.includes("The budget needs a second review."), true, "transcript content still renders");
});

test("shared overview is visible in the workspace instead of hidden from readers", async () => {
  const { render } = await setupWorkspace();
  const sharedSummary = {
    meetingTitle: "Planning sync",
    overview: "The team agreed to review the budget on Friday.",
    timeline: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
  };
  const { container } = await render({ tab: 0, summaryData: sharedSummary, summary: JSON.stringify(sharedSummary) });
  const overview = container.querySelector<HTMLElement>("[data-testid=meeting-minutes-overview]");
  assert.ok(overview);
  assert.equal(overview?.textContent?.includes(sharedSummary.overview), true);
  assert.equal(overview?.getAttribute("aria-hidden"), null, "the overview is exposed as visible content");
});

test("full minutes and copy action use the shared structured summary", async () => {
  const { render, browser } = await setupWorkspace();
  let copied = 0;
  const sharedSummary = {
    meetingTitle: "Planning sync",
    overview: "Shared overview",
    timeline: [{ id: "topic-1", startMs: 1, endMs: 2, speakerName: "Ana", summary: "Review the budget", transcript: "We should review the budget.", kind: "speech" as const }],
    decisions: [{ text: "Review Friday", timeMs: 2 }],
    actionItems: [{ task: "Send the budget", owner: "Ana", deadline: "Friday", timeMs: 3 }],
    openQuestions: [],
  };
  const { container } = await render({
    tab: 2,
    summaryData: sharedSummary,
    summary: JSON.stringify(sharedSummary),
    onCopySummary: () => { copied += 1; },
  });

  assert.equal(container.textContent?.includes("Shared overview"), true);
  assert.equal(container.textContent?.includes("Review the budget"), true);
  assert.equal(container.textContent?.includes("Send the budget"), true);
  const copyButton = container.querySelector<HTMLButtonElement>("[data-testid=meeting-minutes-copy-markdown]");
  assert.ok(copyButton);
  await act(async () => { copyButton?.dispatchEvent(new browser.MouseEvent("click", { bubbles: true })); });
  assert.equal(copied, 1);
});

test("reduced motion disables smooth scrolling but keeps the reveal", async () => {
  const { render, scrollCalls } = await setupWorkspace({ reducedMotion: true });
  const { container } = await render({ tab: 1, focusSegmentId: "seg-3" });
  assert.equal(scrollCalls.length, 1);
  assert.equal(scrollCalls[0].node, row(container, "seg-3"));
  assert.equal(scrollCalls[0].options?.behavior, "auto");
});

test("segment lookup uses refs and data attributes, never a CSS selector built from the id", () => {
  const source = readFileSync(join(process.cwd(), "src", "components", "meeting", "components", "MeetingMinutesWorkspace.tsx"), "utf8");
  assert.match(source, /data-segment-id=\{row\.id\}/, "rows expose the id as a data attribute");
  assert.match(source, /node\.dataset\.segmentId !== focusSegmentId/, "the reveal verifies the exact id before acting");
  assert.match(source, /scrollIntoView\(\{[^}]*block: "center"/, "the reveal centres the row in its transcript pane");
  assert.match(source, /prefers-reduced-motion: reduce/, "reduced motion is honoured in the highlight transition");
  assert.doesNotMatch(source, /querySelector(?:All)?\(\s*`[^`]*\$\{focusSegmentId\}/, "ids are never interpolated into a CSS selector");
});
