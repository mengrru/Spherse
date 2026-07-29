import { useCallback, useEffect, useRef } from "react";

interface Size {
  width: number;
  height: number;
}

interface Position {
  x: number;
  y: number;
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface UseResizeOptions {
  size: Size;
  position: Position;
  onSizeChange: (size: Size) => void;
  onPositionChange: (pos: Position) => void;
  onCommit: (size: Size, pos: Position) => void;
  minWidth: number;
  minHeight: number;
}

export function useResize({ size, position, onSizeChange, onPositionChange, onCommit, minWidth, minHeight }: UseResizeOptions) {
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number; startPosX: number; startPosY: number; edge: ResizeEdge; pointerId: number; lastW: number; lastH: number; lastX: number; lastY: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const createHandler = useCallback((edge: ResizeEdge) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
      startPosX: position.x,
      startPosY: position.y,
      edge,
      pointerId: e.pointerId,
      lastW: size.width,
      lastH: size.height,
      lastX: position.x,
      lastY: position.y,
    };

    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn("setPointerCapture failed — resize may freeze outside window bounds", err);
    }

    const handlePointerMove = (ev: Event) => {
      if (!resizeRef.current || !(ev instanceof PointerEvent)) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      const { startW, startH, startPosX, startPosY, edge } = resizeRef.current;

      let newW = startW;
      let newH = startH;
      let newX = startPosX;
      let newY = startPosY;

      if (edge.includes("e")) newW = Math.max(minWidth, startW + dx);
      if (edge.includes("w")) {
        const proposedW = startW - dx;
        if (proposedW >= minWidth) {
          newW = proposedW;
          newX = startPosX + dx;
        }
      }
      if (edge.includes("s")) newH = Math.max(minHeight, startH + dy);
      if (edge.includes("n")) {
        const proposedH = startH - dy;
        if (proposedH >= minHeight) {
          newH = proposedH;
          newY = startPosY + dy;
        }
      }

      resizeRef.current.lastW = newW;
      resizeRef.current.lastH = newH;
      resizeRef.current.lastX = newX;
      resizeRef.current.lastY = newY;

      onSizeChange({ width: newW, height: newH });
      onPositionChange({ x: newX, y: newY });
    };

    const cleanup = () => {
      resizeRef.current = null;
      cleanupRef.current = null;
      target.removeEventListener("pointermove", handlePointerMove);
      target.removeEventListener("pointerup", handlePointerUp);
      target.removeEventListener("pointercancel", handlePointerCancel);
    };

    const handlePointerUp = (ev: Event) => {
      if (!resizeRef.current || !(ev instanceof PointerEvent)) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      const { startW, startH, startPosX, startPosY, edge } = resizeRef.current;

      let newW = startW;
      let newH = startH;
      let newX = startPosX;
      let newY = startPosY;

      if (edge.includes("e")) newW = Math.max(minWidth, startW + dx);
      if (edge.includes("w")) {
        const proposedW = startW - dx;
        if (proposedW >= minWidth) {
          newW = proposedW;
          newX = startPosX + dx;
        }
      }
      if (edge.includes("s")) newH = Math.max(minHeight, startH + dy);
      if (edge.includes("n")) {
        const proposedH = startH - dy;
        if (proposedH >= minHeight) {
          newH = proposedH;
          newY = startPosY + dy;
        }
      }

      const id = resizeRef.current.pointerId;
      cleanup();
      try {
        target.releasePointerCapture(id);
      } catch {
        // pointer not captured or already released
      }
      onCommit({ width: newW, height: newH }, { x: newX, y: newY });
    };

    const handlePointerCancel = () => {
      if (!resizeRef.current) return;
      const { lastW, lastH, lastX, lastY, pointerId } = resizeRef.current;
      cleanup();
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // pointer not captured or already released
      }
      onCommit({ width: lastW, height: lastH }, { x: lastX, y: lastY });
    };

    target.addEventListener("pointermove", handlePointerMove);
    target.addEventListener("pointerup", handlePointerUp);
    target.addEventListener("pointercancel", handlePointerCancel);
    cleanupRef.current = cleanup;
  }, [size.width, size.height, position.x, position.y, minWidth, minHeight, onSizeChange, onPositionChange, onCommit]);

  return { createHandler };
}
