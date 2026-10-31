export type ScrollbarGeometry = { size: number; offset: number; travel: number; scrollRange: number };

/** Calculate a thumb in CSS pixels without changing the scroll container's layout. */
export function scrollbarGeometry(viewport: number, content: number, scroll: number, track: number): ScrollbarGeometry | null {
  if (![viewport, content, scroll, track].every(Number.isFinite) || viewport <= 0 || track <= 0 || content <= viewport) return null;
  const scrollRange = content - viewport;
  // Preserve a little travel even for very small tracks or one-pixel overflow.
  const minSize = Math.min(24, track / 2);
  const size = Math.min(track - Math.min(2, track / 10), Math.max(minSize, track * viewport / content));
  const travel = Math.max(0, track - size);
  const clampedScroll = Math.max(0, Math.min(scrollRange, scroll));
  return { size, offset: travel * clampedScroll / scrollRange, travel, scrollRange };
}

/** Browsers expose right-to-left scrollLeft as zero at the right and negative to the left. */
export function logicalScrollLeft(scrollLeft: number, range: number, rtl: boolean): number {
  return Math.max(0, Math.min(range, rtl ? range + scrollLeft : scrollLeft));
}

export function physicalScrollLeft(logical: number, range: number, rtl: boolean): number {
  const clamped = Math.max(0, Math.min(range, logical));
  return rtl ? clamped - range : clamped;
}

export function scrollFromThumb(offset: number, geometry: ScrollbarGeometry): number {
  if (geometry.travel <= 0) return 0;
  return Math.max(0, Math.min(geometry.scrollRange, offset / geometry.travel * geometry.scrollRange));
}
