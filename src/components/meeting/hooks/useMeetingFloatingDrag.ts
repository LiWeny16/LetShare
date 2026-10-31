import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampSharingPosition } from "../meetingDrag";

type Position = { left: number; top: number };
type Drag = {
  pointerId: number;
  origin: Position;
  next: Position;
  pointerOffsetX: number;
  pointerOffsetY: number;
  parentLeft: number;
  parentTop: number;
  parentWidth: number;
  parentHeight: number;
  barWidth: number;
  barHeight: number;
  moved: boolean;
};

/** Move the bar with compositor transforms during a drag; commit React state once. */
export function useMeetingFloatingDrag(collapsed: boolean) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef<number | null>(null);
  const [position, setPosition] = useState<Position>({ left: 12, top: 10 });
  const positionRef = useRef(position);
  positionRef.current = position;
  const [centered, setCentered] = useState(true);

  const onDragStart = (event: PointerEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    const parent = bar?.parentElement;
    if (!bar || !parent || dragRef.current) return;
    const rect = bar.getBoundingClientRect();
    const bounds = parent.getBoundingClientRect();
    const origin = { left: rect.left - bounds.left, top: rect.top - bounds.top };
    dragRef.current = {
      pointerId: event.pointerId, origin, next: origin,
      pointerOffsetX: event.clientX - rect.left, pointerOffsetY: event.clientY - rect.top,
      parentLeft: bounds.left, parentTop: bounds.top, parentWidth: bounds.width, parentHeight: bounds.height,
      barWidth: rect.width, barHeight: rect.height, moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const onDragMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bar = barRef.current;
    if (!drag || !bar || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      // Replace the centered transform with an equivalent physical origin once.
      bar.style.left = `${drag.origin.left}px`;
      bar.style.top = `${drag.origin.top}px`;
      bar.style.transform = "none";
      drag.moved = true;
    }
    drag.next = clampSharingPosition(
      event.clientX - drag.parentLeft - drag.pointerOffsetX,
      event.clientY - drag.parentTop - drag.pointerOffsetY,
      drag.parentWidth, drag.parentHeight, drag.barWidth, drag.barHeight,
    );
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        if (dragRef.current !== drag || !barRef.current) return;
        barRef.current.style.transform = `translate3d(${drag.next.left - drag.origin.left}px, ${drag.next.top - drag.origin.top}px, 0)`;
      });
    }
    event.stopPropagation();
  };

  const onDragEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (drag.moved && barRef.current) {
      barRef.current.style.left = `${drag.next.left}px`;
      barRef.current.style.top = `${drag.next.top}px`;
      barRef.current.style.transform = "none";
      setPosition(drag.next);
      setCentered(false);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const onDragKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const movement: Record<string, Position> = {
      ArrowLeft: { left: -16, top: 0 }, ArrowRight: { left: 16, top: 0 },
      ArrowUp: { left: 0, top: -16 }, ArrowDown: { left: 0, top: 16 },
    };
    const delta = movement[event.key];
    const bar = barRef.current;
    const parent = bar?.parentElement;
    if (!delta || !bar || !parent || dragRef.current) return;
    const rect = bar.getBoundingClientRect();
    const bounds = parent.getBoundingClientRect();
    const multiplier = event.shiftKey ? 2 : 1;
    setPosition(clampSharingPosition(rect.left - bounds.left + delta.left * multiplier, rect.top - bounds.top + delta.top * multiplier, bounds.width, bounds.height, rect.width, rect.height));
    setCentered(false);
    event.preventDefault();
    event.stopPropagation();
  };

  useLayoutEffect(() => {
    const clampPosition = () => {
      const bar = barRef.current;
      const parent = bar?.parentElement;
      if (!bar || !parent) return;
      const bounds = parent.getBoundingClientRect();
      const rect = bar.getBoundingClientRect();
      const drag = dragRef.current;
      if (drag) {
        drag.parentLeft = bounds.left;
        drag.parentTop = bounds.top;
        drag.parentWidth = bounds.width;
        drag.parentHeight = bounds.height;
        drag.barWidth = rect.width;
        drag.barHeight = rect.height;
        drag.next = clampSharingPosition(drag.next.left, drag.next.top, bounds.width, bounds.height, rect.width, rect.height);
        return;
      }
      if (!centered) {
        const current = positionRef.current;
        const next = clampSharingPosition(current.left, current.top, bounds.width, bounds.height, rect.width, rect.height);
        if (current.left !== next.left || current.top !== next.top) setPosition(next);
      }
    };
    clampPosition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(clampPosition);
    if (barRef.current) observer?.observe(barRef.current);
    if (barRef.current?.parentElement) observer?.observe(barRef.current.parentElement);
    window.addEventListener("resize", clampPosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", clampPosition);
    };
  }, [centered, collapsed]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    dragRef.current = null;
  }, []);

  return { barRef, position, centered, onDragStart, onDragMove, onDragEnd, onDragKeyDown };
}
