import { useCallback, useRef } from "react";

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
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number; startPosX: number; startPosY: number; edge: ResizeEdge } | null>(null);

  const createHandler = useCallback((edge: ResizeEdge) => (e: React.MouseEvent) => {
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
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
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

      onSizeChange({ width: newW, height: newH });
      onPositionChange({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
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

      resizeRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      onCommit({ width: newW, height: newH }, { x: newX, y: newY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [size.width, size.height, position.x, position.y, minWidth, minHeight, onSizeChange, onPositionChange, onCommit]);

  return { createHandler };
}
