import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { SPLIT_DEFAULT_RATIO, SPLIT_KEYBOARD_STEP, clampRatio } from "./layout";

interface SplitDividerOptions {
  containerRef: RefObject<HTMLElement | null>;
  ratio: number;
  containerWidth: number;
  onCommit: (ratio: number) => void;
}

function isRtl(el: HTMLElement): boolean {
  return getComputedStyle(el).direction === "rtl";
}

function ratioFromPointer(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return SPLIT_DEFAULT_RATIO;
  const paneWidth = isRtl(el) ? clientX - rect.left : rect.right - clientX;
  return clampRatio(paneWidth / rect.width, rect.width);
}

export function useSplitDivider({ containerRef, ratio, containerWidth, onCommit }: SplitDividerOptions) {
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const dragRatioRef = useRef<number | null>(null);

  const updateDrag = (next: number | null) => {
    dragRatioRef.current = next;
    setDragRatio(next);
  };

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    const container = containerRef.current;
    if (!container || event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      return;
    }
    updateDrag(ratioFromPointer(container, event.clientX));

    const onMove = (e: globalThis.PointerEvent) => updateDrag(ratioFromPointer(container, e.clientX));
    const onEnd = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      target.removeEventListener("lostpointercapture", onEnd);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      const final = dragRatioRef.current;
      updateDrag(null);
      if (final !== null) onCommit(final);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
    target.addEventListener("lostpointercapture", onEnd);
  }, [containerRef, onCommit]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const container = containerRef.current;
    const towardStart = event.key === (container && isRtl(container) ? "ArrowRight" : "ArrowLeft");
    const next = ratio + (towardStart ? SPLIT_KEYBOARD_STEP : -SPLIT_KEYBOARD_STEP);
    onCommit(clampRatio(next, containerWidth));
  }, [containerRef, containerWidth, onCommit, ratio]);

  const onDoubleClick = useCallback(() => onCommit(clampRatio(SPLIT_DEFAULT_RATIO, containerWidth)), [containerWidth, onCommit]);

  return { dragRatio, dragging: dragRatio !== null, onPointerDown, onKeyDown, onDoubleClick };
}
