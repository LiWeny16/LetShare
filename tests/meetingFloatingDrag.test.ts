import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Window } from "happy-dom";
import { useMeetingFloatingDrag } from "../src/components/meeting/hooks/useMeetingFloatingDrag";

test("floating sharing controls coalesce pointer movement and keep the final position", async () => {
  const browser = new Window({ url: "https://letshare.test" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client");
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  browser.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  browser.cancelAnimationFrame = (handle) => { frames.delete(handle); };
  let renders = 0;
  function Probe() {
    renders++;
    const drag = useMeetingFloatingDrag(false);
    return React.createElement("div", {
      id: "bar", ref: drag.barRef,
      style: drag.centered ? undefined : { left: drag.position.left, top: drag.position.top, transform: "none" },
    }, React.createElement("div", {
      id: "handle", onPointerDown: drag.onDragStart, onPointerMove: drag.onDragMove,
      onPointerUp: drag.onDragEnd, onPointerCancel: drag.onDragEnd, onLostPointerCapture: drag.onDragEnd,
      onKeyDown: drag.onDragKeyDown,
    }));
  }
  const container = browser.document.createElement("div");
  browser.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => { root.render(React.createElement(Probe)); });
  const bar = browser.document.getElementById("bar")!;
  const handle = browser.document.getElementById("handle")!;
  let viewportWidth = 800;
  Object.defineProperty(container, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: viewportWidth, height: 600 }) });
  Object.defineProperty(bar, "getBoundingClientRect", { value: () => ({ left: Number.parseFloat(bar.style.left) || 100, top: Number.parseFloat(bar.style.top) || 20, width: 200, height: 60 }) });
  Object.defineProperty(handle, "setPointerCapture", { value: () => undefined });
  Object.defineProperty(handle, "hasPointerCapture", { value: () => false });
  const pointer = (type: string, x: number, y: number) => handle.dispatchEvent(new browser.PointerEvent(type, { bubbles: true, pointerId: 7, clientX: x, clientY: y }));
  const initialRenders = renders;
  await act(async () => { pointer("pointerdown", 110, 30); });
  await act(async () => { pointer("pointermove", 130, 40); pointer("pointermove", 170, 50); pointer("pointermove", 190, 60); });
  assert.equal(renders, initialRenders, "pointer moves must not re-render the controls");
  assert.equal(frames.size, 1, "multiple moves must share one animation frame");
  const callback = [...frames.values()][0];
  frames.clear();
  callback(0);
  assert.equal(bar.style.transform, "translate3d(80px, 30px, 0)");
  await act(async () => { pointer("pointerup", 190, 60); });
  assert.equal(bar.style.left, "180px");
  assert.equal(bar.style.top, "50px");
  assert.equal(bar.style.transform, "none");
  assert.equal(renders, initialRenders + 1, "the final position is committed once");
  await act(async () => { handle.dispatchEvent(new browser.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })); });
  assert.equal(bar.style.left, "196px", "keyboard arrows move the controls");
  await act(async () => { pointer("pointerdown", 206, 60); pointer("pointermove", 226, 70); pointer("pointercancel", 226, 70); });
  assert.equal(frames.size, 0, "cancelling a pointer cancels any pending frame");
  assert.equal(bar.style.left, "216px", "pointer cancellation preserves the last visible position");
  viewportWidth = 250;
  await act(async () => { browser.dispatchEvent(new browser.Event("resize")); });
  assert.equal(bar.style.left, "38px", "resizing keeps the controls within the parent bounds");
  await act(async () => { root.unmount(); });
  await browser.happyDOM.close();
});
