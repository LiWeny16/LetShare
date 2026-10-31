import { logicalScrollLeft, physicalScrollLeft, scrollFromThumb, scrollbarGeometry, type ScrollbarGeometry } from "./scrollbarGeometry";

type Axis = "vertical" | "horizontal";
type Bounds = { left: number; top: number; right: number; bottom: number };
type TrackState = { element: HTMLDivElement; thumb: HTMLDivElement; geometry: ScrollbarGeometry | null };
type DragState = { axis: Axis; pointerId: number; start: number; thumbOffset: number; target: HTMLElement };

const TRACK_SIZE = 12;
const HIDE_DELAY_MS = 1100;
const ROOT_CLASS = "app-overlay-scrollbars";

function clipBounds(rect: Bounds, clip: Bounds, horizontal: boolean, vertical: boolean): Bounds {
  return {
    left: horizontal ? Math.max(rect.left, clip.left) : rect.left,
    right: horizontal ? Math.min(rect.right, clip.right) : rect.right,
    top: vertical ? Math.max(rect.top, clip.top) : rect.top,
    bottom: vertical ? Math.min(rect.bottom, clip.bottom) : rect.bottom,
  };
}

function clips(value: string): boolean {
  return value === "hidden" || value === "clip" || value === "auto" || value === "scroll" || value === "overlay";
}

function axisOverflow(style: CSSStyleDeclaration, axis: "x" | "y"): string {
  return (axis === "x" ? style.overflowX : style.overflowY) || style.overflow || "visible";
}

/** Keep native scrolling intact, and draw only the active scroll container's thumbs above its contents. */
export function installOverlayScrollbars(doc: Document = document, win: Window = window): () => void {
  const root = doc.documentElement;
  const browser = win as Window & typeof globalThis;
  const supported = typeof browser.PointerEvent === "function" && typeof win.requestAnimationFrame === "function" &&
    (browser.CSS?.supports?.("scrollbar-width", "none") || "webkitAppearance" in root.style);
  if (!doc.body || !supported) return () => undefined;

  const makeTrack = (axis: Axis): TrackState => {
    const element = doc.createElement("div");
    const thumb = doc.createElement("div");
    element.className = `app-scrollbar app-scrollbar--${axis}`;
    element.setAttribute("aria-hidden", "true");
    thumb.className = "app-scrollbar__thumb";
    element.appendChild(thumb);
    return { element, thumb, geometry: null };
  };
  const tracks: Record<Axis, TrackState> = { vertical: makeTrack("vertical"), horizontal: makeTrack("horizontal") };
  const media = win.matchMedia?.("(forced-colors: active)");
  let active: HTMLElement | null = null;
  let dragging: DragState | null = null;
  let lastBounds: Bounds | null = null;
  let frame = 0;
  let hideTimer = 0;
  let disposed = false;
  let visible = false;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;

  const attachTracks = () => {
    const fullscreen = doc.fullscreenElement;
    const host = fullscreen && !/^(VIDEO|AUDIO|CANVAS|IMG)$/.test(fullscreen.tagName) ? fullscreen : doc.body;
    for (const track of Object.values(tracks)) if (track.element.parentElement !== host) host.appendChild(track.element);
  };

  const setVisible = (visible: boolean) => {
    for (const track of Object.values(tracks)) track.element.dataset.visible = String(visible && Boolean(track.geometry));
  };

  const cancelHide = () => {
    if (hideTimer) win.clearTimeout(hideTimer);
    hideTimer = 0;
  };

  const queueHide = () => {
    cancelHide();
    if (!dragging) hideTimer = win.setTimeout(() => { hideTimer = 0; visible = false; setVisible(false); }, HIDE_DELAY_MS);
  };

  const isRoot = (element: HTMLElement) => element === doc.scrollingElement;
  const canScroll = (element: HTMLElement): boolean => {
    if (!element.isConnected || element.closest(".app-scrollbar")) return false;
    const style = win.getComputedStyle(element);
    const scrollable = (value: string) => value === "auto" || value === "scroll" || value === "overlay";
    const rootVisible = (value: string) => value !== "hidden" && value !== "clip";
    const x = element.scrollWidth > element.clientWidth && (isRoot(element) ? rootVisible(axisOverflow(style, "x")) : scrollable(axisOverflow(style, "x")));
    const y = element.scrollHeight > element.clientHeight && (isRoot(element) ? rootVisible(axisOverflow(style, "y")) : scrollable(axisOverflow(style, "y")));
    return x || y;
  };

  const nearestScrollable = (target: EventTarget | null): HTMLElement | null => {
    let node = target && "nodeType" in target && (target as Node).nodeType === 1 ? target as HTMLElement : null;
    while (node) {
      // Global CSS does not cross a shadow boundary; keep shadow-root scrollbars native.
      if (node.getRootNode() !== doc) return null;
      if (canScroll(node)) return node;
      node = node.parentElement;
    }
    const scrolling = doc.scrollingElement as HTMLElement | null;
    return scrolling && canScroll(scrolling) ? scrolling : null;
  };

  const viewportBounds = (): Bounds => ({ left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight });

  const contentBounds = (element: HTMLElement): Bounds => {
    if (isRoot(element)) return viewportBounds();
    const rect = element.getBoundingClientRect();
    const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
    const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
    const left = rect.left + element.clientLeft * scaleX;
    const top = rect.top + element.clientTop * scaleY;
    return { left, top, right: left + element.clientWidth * scaleX, bottom: top + element.clientHeight * scaleY };
  };

  const clippingBounds = (element: HTMLElement): Bounds => {
    let clipped = viewportBounds();
    for (let parent = element.parentElement; parent && parent !== doc.documentElement; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent);
      const clipX = clips(axisOverflow(style, "x"));
      const clipY = clips(axisOverflow(style, "y"));
      if (clipX || clipY) clipped = clipBounds(clipped, contentBounds(parent), clipX, clipY);
    }
    return clipped;
  };

  const positionTrack = (axis: Axis, rect: Bounds, clipped: Bounds, geometry: ScrollbarGeometry | null) => {
    const track = tracks[axis];
    track.geometry = geometry;
    if (!geometry || rect.right <= rect.left || rect.bottom <= rect.top || clipped.right <= rect.left || clipped.left >= rect.right || clipped.bottom <= rect.top || clipped.top >= rect.bottom) {
      track.element.dataset.visible = "false";
      return;
    }
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    Object.assign(track.element.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${width}px`, height: `${height}px`,
      clipPath: `inset(${Math.max(0, clipped.top - rect.top)}px ${Math.max(0, rect.right - clipped.right)}px ${Math.max(0, rect.bottom - clipped.bottom)}px ${Math.max(0, clipped.left - rect.left)}px)`,
    });
    if (axis === "vertical") Object.assign(track.thumb.style, { height: `${geometry.size}px`, transform: `translateY(${geometry.offset}px)` });
    else Object.assign(track.thumb.style, { width: `${geometry.size}px`, transform: `translateX(${geometry.offset}px)` });
    track.element.dataset.visible = String(visible);
  };

  const update = () => {
    frame = 0;
    if (disposed || media?.matches || !active || !canScroll(active)) { setVisible(false); return; }
    attachTracks();
    const bounds = contentBounds(active);
    lastBounds = bounds;
    const clip = clippingBounds(active);
    const scaleX = active.clientWidth ? (bounds.right - bounds.left) / active.clientWidth : 1;
    const scaleY = active.clientHeight ? (bounds.bottom - bounds.top) / active.clientHeight : 1;
    const style = win.getComputedStyle(active);
    const canAxisScroll = (value: string) => isRoot(active!) ? value !== "hidden" && value !== "clip" : value === "auto" || value === "scroll" || value === "overlay";
    const hasVertical = active.scrollHeight > active.clientHeight && canAxisScroll(axisOverflow(style, "y"));
    const hasHorizontal = active.scrollWidth > active.clientWidth && canAxisScroll(axisOverflow(style, "x"));
    const verticalLength = Math.max(0, bounds.bottom - bounds.top - (hasHorizontal ? TRACK_SIZE : 0));
    const horizontalLength = Math.max(0, bounds.right - bounds.left - (hasVertical ? TRACK_SIZE : 0));
    const horizontalRange = Math.max(0, active.scrollWidth - active.clientWidth);
    const logicalX = logicalScrollLeft(active.scrollLeft, horizontalRange, style.direction === "rtl");
    const vertical = hasVertical ? scrollbarGeometry(active.clientHeight * scaleY, active.scrollHeight * scaleY, active.scrollTop * scaleY, verticalLength) : null;
    const horizontal = hasHorizontal ? scrollbarGeometry(active.clientWidth * scaleX, active.scrollWidth * scaleX, logicalX * scaleX, horizontalLength) : null;
    positionTrack("vertical", { left: bounds.right - TRACK_SIZE, right: bounds.right, top: bounds.top, bottom: bounds.top + verticalLength }, clip, vertical);
    positionTrack("horizontal", { left: bounds.left, right: bounds.left + horizontalLength, top: bounds.bottom - TRACK_SIZE, bottom: bounds.bottom }, clip, horizontal);
  };

  const scheduleUpdate = () => {
    if (!frame && !disposed && (visible || dragging)) frame = win.requestAnimationFrame(update);
  };

  const setActive = (element: HTMLElement | null) => {
    if (active === element) return;
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = null;
    mutationObserver = null;
    active = element;
    lastBounds = null;
    if (!active) { setVisible(false); return; }
    if ("ResizeObserver" in win) {
      resizeObserver = new browser.ResizeObserver(() => { lastBounds = null; scheduleUpdate(); });
      resizeObserver.observe(active);
      for (let parent = active.parentElement, count = 0; parent && count < 6; parent = parent.parentElement, count++) resizeObserver.observe(parent);
    }
    if ("MutationObserver" in win) {
      mutationObserver = new browser.MutationObserver(scheduleUpdate);
      mutationObserver.observe(active, { childList: true, characterData: true, subtree: true });
    }
  };

  const reveal = (element: HTMLElement | null) => {
    if (media?.matches || dragging) return;
    setActive(element);
    if (active) { visible = true; scheduleUpdate(); queueHide(); }
    else { visible = false; cancelHide(); }
  };

  const onPointerOver = (event: Event) => {
    if (dragging) return;
    const target = event.target as Element | null;
    if (target?.closest?.(".app-scrollbar")) { cancelHide(); return; }
    reveal(nearestScrollable(event.target));
  };
  const onPointerOut = (event: PointerEvent) => {
    const target = event.target as Element | null;
    if (!event.relatedTarget && target?.closest?.(".app-scrollbar")) queueHide();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (visible || dragging || !active || event.pointerType === "touch") return;
    const target = event.target as Node | null;
    if (!target || !active.contains(target)) return;
    if (!lastBounds) lastBounds = contentBounds(active);
    const { left, right, top, bottom } = lastBounds;
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) return;
    if (event.clientX >= right - TRACK_SIZE * 2 || event.clientY >= bottom - TRACK_SIZE * 2) reveal(active);
  };
  const onFocus = (event: Event) => reveal(nearestScrollable(event.target));
  const onScroll = (event: Event) => {
    const target = event.target === doc ? doc.scrollingElement : event.target;
    reveal(nearestScrollable(target));
  };
  const onResize = () => { lastBounds = null; if (active) scheduleUpdate(); };

  const finishDrag = (event?: PointerEvent) => {
    if (event && dragging && event.pointerId !== dragging.pointerId) return;
    dragging = null;
    win.removeEventListener("pointermove", onDragMove);
    win.removeEventListener("pointerup", finishDrag);
    win.removeEventListener("pointercancel", finishDrag);
    queueHide();
  };
  const onDragMove = (event: PointerEvent) => {
    const drag = dragging;
    if (!drag || event.pointerId !== drag.pointerId || !drag.target.isConnected) return;
    const track = tracks[drag.axis];
    if (!track.geometry) return;
    const coordinate = drag.axis === "vertical" ? event.clientY : event.clientX;
    const scroll = scrollFromThumb(drag.thumbOffset + coordinate - drag.start, track.geometry);
    const bounds = contentBounds(drag.target);
    if (drag.axis === "vertical") {
      const scale = drag.target.clientHeight ? (bounds.bottom - bounds.top) / drag.target.clientHeight : 1;
      drag.target.scrollTop = scroll / scale;
    } else {
      const scale = drag.target.clientWidth ? (bounds.right - bounds.left) / drag.target.clientWidth : 1;
      const range = Math.max(0, drag.target.scrollWidth - drag.target.clientWidth);
      drag.target.scrollLeft = physicalScrollLeft(scroll / scale, range, win.getComputedStyle(drag.target).direction === "rtl");
    }
    event.preventDefault();
    scheduleUpdate();
  };
  const startDrag = (axis: Axis, event: PointerEvent) => {
    if (!active || !tracks[axis].geometry || (event.pointerType === "mouse" && event.button !== 0)) return;
    cancelHide();
    dragging = { axis, pointerId: event.pointerId, start: axis === "vertical" ? event.clientY : event.clientX, thumbOffset: tracks[axis].geometry!.offset, target: active };
    event.preventDefault();
    event.stopPropagation();
    win.addEventListener("pointermove", onDragMove, { passive: false });
    win.addEventListener("pointerup", finishDrag);
    win.addEventListener("pointercancel", finishDrag);
  };
  const verticalDown = (event: PointerEvent) => startDrag("vertical", event);
  const horizontalDown = (event: PointerEvent) => startDrag("horizontal", event);
  const onMediaChange = () => {
    if (media?.matches) { finishDrag(); cancelHide(); visible = false; setVisible(false); root.classList.remove(ROOT_CLASS); }
    else { root.classList.add(ROOT_CLASS); if (active) scheduleUpdate(); }
  };

  attachTracks();
  tracks.vertical.thumb.addEventListener("pointerdown", verticalDown);
  tracks.horizontal.thumb.addEventListener("pointerdown", horizontalDown);
  doc.addEventListener("pointerover", onPointerOver, true);
  doc.addEventListener("pointerout", onPointerOut, true);
  doc.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  doc.addEventListener("focusin", onFocus, true);
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  doc.addEventListener("fullscreenchange", onResize);
  win.addEventListener("resize", onResize);
  if (media?.addEventListener) media.addEventListener("change", onMediaChange);
  else media?.addListener?.(onMediaChange);
  onMediaChange();

  return () => {
    disposed = true;
    finishDrag();
    cancelHide();
    if (frame) win.cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    doc.removeEventListener("pointerover", onPointerOver, true);
    doc.removeEventListener("pointerout", onPointerOut, true);
    doc.removeEventListener("pointermove", onPointerMove, true);
    doc.removeEventListener("focusin", onFocus, true);
    doc.removeEventListener("scroll", onScroll, true);
    doc.removeEventListener("fullscreenchange", onResize);
    win.removeEventListener("resize", onResize);
    if (media?.removeEventListener) media.removeEventListener("change", onMediaChange);
    else media?.removeListener?.(onMediaChange);
    tracks.vertical.thumb.removeEventListener("pointerdown", verticalDown);
    tracks.horizontal.thumb.removeEventListener("pointerdown", horizontalDown);
    tracks.vertical.element.remove();
    tracks.horizontal.element.remove();
    root.classList.remove(ROOT_CLASS);
  };
}
