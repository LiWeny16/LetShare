import test from "node:test";
import assert from "node:assert/strict";
import React, { act, useState } from "react";
import { Window } from "happy-dom";
import { useMeetingPanelResize } from "../src/components/meeting/hooks/useMeetingPanelResize";

test("panel drag batches pointer moves, commits once, and supports keyboard and close threshold", async () => {
  const browser = new Window({ url: "https://letshare.test" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client");
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  browser.requestAnimationFrame = (callback) => { frames.set(++nextId, callback); return nextId; };
  browser.cancelAnimationFrame = (handle) => { frames.delete(handle); };
  let renders = 0;
  function Probe() {
    renders++;
    const [open, setOpen] = useState(true);
    const resize = useMeetingPanelResize(open, false, setOpen);
    return React.createElement("div", null,
      React.createElement("div", {
        id: "panel", ref: resize.panelRef, style: { width: resize.panelWidth, display: open ? "block" : "none" },
        "data-compact-icons": String(resize.panelWidth < 300), "data-compact-count": String(resize.panelWidth < 340),
      }),
      React.createElement("div", {
        id: "separator", onPointerDown: resize.onPanelResizeStart, onPointerMove: resize.onPanelResizeMove,
        onPointerUp: resize.onPanelResizeEnd, onPointerCancel: resize.onPanelResizeEnd, onKeyDown: resize.onPanelResizeKeyDown,
        "aria-valuenow": resize.panelWidth,
      }),
    );
  }
  const container = browser.document.createElement("div");
  browser.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => { root.render(React.createElement(Probe)); });
  const panel = browser.document.getElementById("panel")!;
  const handle = browser.document.getElementById("separator")!;
  Object.defineProperty(handle, "setPointerCapture", { value: () => undefined });
  Object.defineProperty(handle, "hasPointerCapture", { value: () => false });
  const pointer = (type: string, x: number) => handle.dispatchEvent(new browser.PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x }));
  const initialRenders = renders;
  await act(async () => { pointer("pointerdown", 400); pointer("pointermove", 420); pointer("pointermove", 440); pointer("pointermove", 450); });
  assert.equal(renders, initialRenders, "dragging must not re-render the meeting tree");
  assert.equal(frames.size, 1, "rapid moves must be painted in a single frame");
  const callback = [...frames.values()][0];
  frames.clear();
  callback(0);
  assert.equal(panel.style.width, "270px");
  assert.equal(panel.dataset.compactIcons, "true");
  assert.equal(handle.getAttribute("aria-valuenow"), "270");
  await act(async () => { pointer("pointerup", 450); });
  assert.equal(renders, initialRenders + 1);
  await act(async () => { handle.dispatchEvent(new browser.KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" })); });
  assert.equal(panel.style.width, "286px", "keyboard resize expands toward the left");
  await act(async () => { handle.dispatchEvent(new browser.KeyboardEvent("keydown", { bubbles: true, key: "End" })); });
  assert.equal(panel.style.width, "520px");
  await act(async () => { pointer("pointerdown", 400); pointer("pointermove", 677); });
  assert.equal(panel.style.display, "none", "dragging past the close threshold closes the panel");
  assert.equal(frames.size, 0);
  await act(async () => { root.unmount(); });
  await browser.happyDOM.close();
});
