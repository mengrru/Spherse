import { useCallback, useEffect, useRef } from "react";

interface Position {
  x: number;
  y: number;
}

interface UseDragOptions {
  position: Position;
  onPositionChange: (pos: Position) => void;
  onCommit: (pos: Position) => void;
  containerWidth: number;
  containerHeight: number;
  ignoreSelector?: string;
}

export function useDrag({ position, onPositionChange, onCommit, containerWidth, containerHeight, ignoreSelector }: UseDragOptions) {
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number; pointerId: number; lastX: number; lastY: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (ignoreSelector && e.target instanceof Element && e.target.closest(ignoreSelector)) {
      return;
    }

    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
      pointerId: e.pointerId,
      lastX: position.x,
      lastY: position.y,
    };

    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn("setPointerCapture failed — drag may freeze outside window bounds", err);
    }

    const handlePointerMove = (ev: Event) => {
      if (!dragRef.current || !(ev instanceof PointerEvent)) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(dragRef.current.startPosX + dx, window.innerWidth - containerWidth));
      const newY = Math.max(0, Math.min(dragRef.current.startPosY + dy, window.innerHeight - containerHeight));
      dragRef.current.lastX = newX;
      dragRef.current.lastY = newY;
      onPositionChange({ x: newX, y: newY });
    };

    const cleanup = () => {
      dragRef.current = null;
      cleanupRef.current = null;
      target.removeEventListener("pointermove", handlePointerMove);
      target.removeEventListener("pointerup", handlePointerUp);
      target.removeEventListener("pointercancel", handlePointerCancel);
    };

    const handlePointerUp = (ev: Event) => {
      if (!dragRef.current || !(ev instanceof PointerEvent)) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(dragRef.current.startPosX + dx, window.innerWidth - containerWidth));
      const newY = Math.max(0, Math.min(dragRef.current.startPosY + dy, window.innerHeight - containerHeight));
      const id = dragRef.current.pointerId;
      cleanup();
      try {
        target.releasePointerCapture(id);
      } catch {
        // pointer not captured or already released
      }
      onCommit({ x: newX, y: newY });
    };

    const handlePointerCancel = () => {
      if (!dragRef.current) return;
      const { lastX, lastY, pointerId } = dragRef.current;
      cleanup();
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // pointer not captured or already released
      }
      onCommit({ x: lastX, y: lastY });
    };

    target.addEventListener("pointermove", handlePointerMove);
    target.addEventListener("pointerup", handlePointerUp);
    target.addEventListener("pointercancel", handlePointerCancel);
    cleanupRef.current = cleanup;
  }, [position.x, position.y, containerWidth, containerHeight, onPositionChange, onCommit, ignoreSelector]);

  return { onPointerDown: handlePointerDown };
}
