import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Window } from "happy-dom";

test("meeting join loader renders the elephant loader with and without a label", async () => {
  const browser = new Window({ url: "https://letshare.test" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  for (const key of ["HTMLElement", "Element", "Node", "DocumentFragment", "SVGElement", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: (browser as unknown as Record<string, unknown>)[key] });
  }
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: false, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) });

  const { default: MeetingJoinLoader } = await import("../src/components/meeting/components/MeetingJoinLoader");
  const { createRoot } = await import("react-dom/client");

  const container = browser.document.createElement("div") as unknown as HTMLElement;
  browser.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(MeetingJoinLoader));
    });
    const bare = container.querySelector('[data-testid="meeting-join-loader"]');
    assert.ok(bare, "the loader renders without a label");
    assert.ok(bare?.querySelector("svg"), "the loader contains the elephant SVG");
    assert.ok(!bare?.textContent?.trim(), "no label renders no text");

    await act(async () => {
      root.render(React.createElement(MeetingJoinLoader, { label: "正在加入…" }));
    });
    const withLabel = container.querySelector('[data-testid="meeting-join-loader"]');
    assert.ok(withLabel?.querySelector("svg"), "the labelled loader still contains the elephant SVG");
    assert.ok(withLabel?.textContent?.includes("正在加入…"), "the label appears only when passed");
  } finally {
    await act(async () => { root.unmount(); });
    browser.close();
  }
});
