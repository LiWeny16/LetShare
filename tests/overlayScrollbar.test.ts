import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { installOverlayScrollbars } from "../src/app/libs/ui/overlayScrollbars";
import { logicalScrollLeft, physicalScrollLeft, scrollFromThumb, scrollbarGeometry } from "../src/app/libs/ui/scrollbarGeometry";

test("thumb geometry clamps both ends and remains draggable on tiny tracks", () => {
  const initial = scrollbarGeometry(100, 1000, 0, 100);
  assert.ok(initial);
  assert.equal(initial.size, 24);
  assert.equal(initial.offset, 0);
  assert.equal(scrollFromThumb(initial.travel, initial), 900);
  assert.equal(scrollbarGeometry(100, 1000, 9999, 100)?.offset, initial.travel);
  assert.equal(scrollbarGeometry(100, 100, 0, 100), null);
  const tiny = scrollbarGeometry(100, 101, 0, 10);
  assert.ok(tiny && tiny.travel > 0);
  assert.equal(scrollFromThumb(tiny.travel, tiny), 1);
  assert.equal(scrollbarGeometry(NaN, 200, 0, 100), null);
});

test("RTL scroll positions round trip and clamp", () => {
  assert.equal(logicalScrollLeft(0, 300, true), 300);
  assert.equal(logicalScrollLeft(-300, 300, true), 0);
  assert.equal(physicalScrollLeft(100, 300, true), -200);
  assert.equal(logicalScrollLeft(-200, 300, true), 100);
  assert.equal(physicalScrollLeft(999, 300, false), 300);
});

test("unsupported environments keep native scrollbars", async () => {
  const browser = new Window({ url: "http://localhost/" });
  Object.defineProperty(browser, "PointerEvent", { configurable: true, value: undefined });
  const dispose = installOverlayScrollbars(browser.document as unknown as Document, browser as unknown as globalThis.Window);
  assert.equal(browser.document.documentElement.classList.contains("app-overlay-scrollbars"), false);
  assert.equal(browser.document.querySelectorAll(".app-scrollbar").length, 0);
  dispose();
  await browser.happyDOM.abort();
});

function metrics(element: HTMLElement, options: { left: number; top: number; width: number; height: number; scrollWidth: number; scrollHeight: number }) {
  for (const [name, value] of Object.entries({ clientWidth: options.width, clientHeight: options.height, offsetWidth: options.width, offsetHeight: options.height, scrollWidth: options.scrollWidth, scrollHeight: options.scrollHeight, clientLeft: 0, clientTop: 0 })) {
    Object.defineProperty(element, name, { configurable: true, value });
  }
  element.getBoundingClientRect = () => ({ x: options.left, y: options.top, left: options.left, top: options.top, right: options.left + options.width, bottom: options.top + options.height, width: options.width, height: options.height, toJSON: () => ({}) });
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 35));

test("nested vertical and horizontal containers keep native scroll and support dragging", async () => {
  const browser = new Window({ url: "http://localhost/" });
  const doc = browser.document;
  const outer = doc.createElement("div");
  const inner = doc.createElement("div");
  const content = doc.createElement("span");
  outer.style.overflow = "auto";
  inner.style.overflow = "auto";
  outer.append(inner);
  inner.append(content);
  doc.body.append(outer);
  metrics(outer as unknown as HTMLElement, { left: 0, top: 0, width: 300, height: 300, scrollWidth: 300, scrollHeight: 600 });
  metrics(inner as unknown as HTMLElement, { left: 20, top: 20, width: 200, height: 200, scrollWidth: 500, scrollHeight: 800 });
  const dispose = installOverlayScrollbars(doc as unknown as Document, browser as unknown as globalThis.Window);
  try {
    assert.equal(doc.documentElement.classList.contains("app-overlay-scrollbars"), true);
    content.dispatchEvent(new browser.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await tick();
    const vertical = doc.querySelector(".app-scrollbar--vertical") as unknown as HTMLElement;
    const horizontal = doc.querySelector(".app-scrollbar--horizontal") as unknown as HTMLElement;
    assert.equal(vertical.dataset.visible, "true");
    assert.equal(horizontal.dataset.visible, "true");
    assert.equal(vertical.style.left, "208px");
    const verticalThumb = vertical.querySelector(".app-scrollbar__thumb")!;
    inner.scrollTop = 120;
    inner.dispatchEvent(new browser.Event("scroll"));
    await tick();
    assert.notEqual((verticalThumb as unknown as HTMLElement).style.transform, "translateY(0px)", "native keyboard or wheel scrolling updates the thumb");
    verticalThumb.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", pointerId: 1, button: 0, clientY: 30 }));
    browser.dispatchEvent(new browser.PointerEvent("pointermove", { pointerType: "mouse", pointerId: 1, clientY: 80, cancelable: true }));
    browser.dispatchEvent(new browser.PointerEvent("pointerup", { pointerType: "mouse", pointerId: 1 }));
    assert.ok(inner.scrollTop > 120, "dragging the vertical thumb scrolls the inner element");
    assert.equal(outer.scrollTop, 0, "the outer container does not move");
    await tick();
    const horizontalThumb = horizontal.querySelector(".app-scrollbar__thumb")!;
    horizontalThumb.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 2, clientX: 30 }));
    browser.dispatchEvent(new browser.PointerEvent("pointermove", { pointerType: "touch", pointerId: 2, clientX: 80, cancelable: true }));
    browser.dispatchEvent(new browser.PointerEvent("pointerup", { pointerType: "touch", pointerId: 2 }));
    assert.ok(inner.scrollLeft > 0, "touch dragging the horizontal thumb scrolls the inner element");
  } finally {
    dispose();
    assert.equal(doc.querySelectorAll(".app-scrollbar").length, 0);
    assert.equal(doc.documentElement.classList.contains("app-overlay-scrollbars"), false);
    await browser.happyDOM.abort();
  }
});

test("forced colors restore native scrollbars and fullscreen retains the overlay", async () => {
  const browser = new Window({ url: "http://localhost/" });
  const doc = browser.document;
  const query = new browser.EventTarget() as EventTarget & { matches: boolean };
  query.matches = false;
  Object.defineProperty(browser, "matchMedia", { configurable: true, value: () => query });
  const host = doc.createElement("div");
  host.style.overflowY = "auto";
  doc.body.append(host);
  metrics(host as unknown as HTMLElement, { left: 0, top: 0, width: 250, height: 200, scrollWidth: 250, scrollHeight: 600 });
  const dispose = installOverlayScrollbars(doc as unknown as Document, browser as unknown as globalThis.Window);
  try {
    host.dispatchEvent(new browser.Event("focusin", { bubbles: true }));
    await tick();
    Object.defineProperty(doc, "fullscreenElement", { configurable: true, value: host });
    doc.dispatchEvent(new browser.Event("fullscreenchange"));
    await tick();
    assert.equal(host.querySelectorAll(".app-scrollbar").length, 2);
    query.matches = true;
    query.dispatchEvent(new browser.Event("change"));
    assert.equal(doc.documentElement.classList.contains("app-overlay-scrollbars"), false);
    query.matches = false;
    query.dispatchEvent(new browser.Event("change"));
    assert.equal(doc.documentElement.classList.contains("app-overlay-scrollbars"), true);
  } finally {
    dispose();
    await browser.happyDOM.abort();
  }
});

test("idle thumbs stay hidden after content mutations and clipped tracks do not escape their parent", async () => {
  const browser = new Window({ url: "http://localhost/" });
  const doc = browser.document;
  const outer = doc.createElement("div");
  const inner = doc.createElement("div");
  outer.style.overflow = "hidden";
  inner.style.overflow = "auto";
  outer.append(inner);
  doc.body.append(outer);
  metrics(outer as unknown as HTMLElement, { left: 0, top: 0, width: 198, height: 200, scrollWidth: 198, scrollHeight: 200 });
  metrics(inner as unknown as HTMLElement, { left: 0, top: 0, width: 200, height: 200, scrollWidth: 200, scrollHeight: 600 });
  const dispose = installOverlayScrollbars(doc as unknown as Document, browser as unknown as globalThis.Window);
  try {
    inner.dispatchEvent(new browser.Event("focusin", { bubbles: true }));
    await tick();
    const vertical = doc.querySelector(".app-scrollbar--vertical") as unknown as HTMLElement;
    assert.equal(vertical.dataset.visible, "true");
    assert.match(vertical.style.clipPath, /inset\(0px 2px 0px 0px\)/);
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    assert.equal(vertical.dataset.visible, "false");
    inner.append(doc.createElement("span"));
    await tick();
    assert.equal(vertical.dataset.visible, "false", "content updates must not re-show a hidden thumb");
    inner.dispatchEvent(new browser.PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 194, clientY: 100 }));
    await tick();
    assert.equal(vertical.dataset.visible, "true", "moving back to the scroll edge reveals the draggable thumb");
  } finally {
    dispose();
    await browser.happyDOM.abort();
  }
});
