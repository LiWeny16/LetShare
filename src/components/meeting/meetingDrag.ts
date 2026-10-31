/** Geometry shared by meeting panel resizing and the floating sharing bar. */
export function panelWidthForPointer(startWidth: number, startX: number, clientX: number): { width: number; close: boolean } {
  const raw = startWidth - (clientX - startX);
  return { width: Math.min(520, Math.max(260, raw)), close: raw <= 244 };
}

export function clampSharingPosition(left: number, top: number, parentWidth: number, parentHeight: number, barWidth: number, barHeight: number) {
  return {
    left: Math.min(Math.max(12, parentWidth - barWidth - 12), Math.max(12, left)),
    top: Math.min(Math.max(10, parentHeight - barHeight - 10), Math.max(10, top)),
  };
}
