/**
 * Pointer targets inside the caption bar that belong to its controls rather
 * than to dragging. Capturing the pointer on the bar would steal the click
 * from a language menu (it opens on mousedown), leaving it impossible to pick
 * an item or dismiss it.
 */
const CAPTION_DRAG_HANDLE = "[data-caption-drag-handle]";
const CAPTION_DRAG_EXCLUSIONS =
  "[data-caption-no-drag], button, [role='combobox'], [role='button'], input, a, .MuiSelect-root, .MuiInputBase-root";

export type CaptionPointerIntent = "outside" | "drag-handle" | "control" | "surface";

/**
 * Classify a pointerdown inside the caption bar.
 *
 * `outside` matters because React portals (the MUI language menu and its
 * full-screen backdrop) bubble through the React tree even though their DOM
 * lives in <body>. Treating those as surface drags captured the pointer and
 * made the open menu impossible to close.
 */
export function captionPointerIntent(currentTarget: Element | null, target: Element | null): CaptionPointerIntent {
  if (!currentTarget || !target || !currentTarget.contains(target)) return "outside";
  if (target.closest?.(CAPTION_DRAG_HANDLE)) return "drag-handle";
  if (target.closest?.(CAPTION_DRAG_EXCLUSIONS)) return "control";
  return "surface";
}

export function isCaptionDragExcluded(target: Element | null): boolean {
  return Boolean(target?.closest?.(CAPTION_DRAG_EXCLUSIONS));
}
