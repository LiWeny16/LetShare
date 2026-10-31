import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent, type SetStateAction } from "react";
import { panelWidthForPointer } from "../meetingDrag";

type ResizeDrag = { pointerId: number; startX: number; startWidth: number; width: number; handle: HTMLDivElement };

/** Keep the panel responsive while avoiding a whole-room React render per move. */
export function useMeetingPanelResize(panelOpen: boolean, isMobile: boolean, setPanelOpen: Dispatch<SetStateAction<boolean>>) {
  const [panelWidth, setPanelWidth] = useState(320);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ResizeDrag | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    dragRef.current = null;
  }, []);

  useEffect(() => {
    if (panelOpen && !isMobile) return;
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setPanelWidth(drag.width);
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  }, [panelOpen, isMobile]);

  const applyWidth = (drag: ResizeDrag) => {
    if (panelRef.current) {
      panelRef.current.style.width = `${drag.width}px`;
      panelRef.current.dataset.compactIcons = String(drag.width < 300);
      panelRef.current.dataset.compactCount = String(drag.width < 340);
    }
    drag.handle.setAttribute("aria-valuenow", String(drag.width));
  };

  const onPanelResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    if (isMobile || !panelOpen || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: panelWidth, width: panelWidth, handle: event.currentTarget };
  };

  const onPanelResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const next = panelWidthForPointer(drag.startWidth, drag.startX, event.clientX);
    if (next.close) {
      dragRef.current = null;
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      setPanelWidth(drag.width);
      setPanelOpen(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    drag.width = next.width;
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        if (dragRef.current === drag) applyWidth(drag);
      });
    }
  };

  const onPanelResizeEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    applyWidth(drag);
    setPanelWidth(drag.width);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onPanelResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    const step = event.shiftKey ? 32 : 16;
    const widths: Record<string, number> = { ArrowLeft: panelWidth + step, ArrowRight: panelWidth - step, Home: 260, End: 520 };
    const width = widths[event.key];
    if (width === undefined) return;
    setPanelWidth(Math.min(520, Math.max(260, width)));
    event.preventDefault();
  };

  return { panelWidth, setPanelWidth, panelRef, onPanelResizeStart, onPanelResizeMove, onPanelResizeEnd, onPanelResizeKeyDown };
}
