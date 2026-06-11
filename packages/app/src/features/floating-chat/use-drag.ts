import { useCallback, useRef } from "react";

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
}

export function useDrag({ position, onPositionChange, onCommit, containerWidth, containerHeight }: UseDragOptions) {
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(dragRef.current.startPosX + dx, window.innerWidth - containerWidth));
      const newY = Math.max(0, Math.min(dragRef.current.startPosY + dy, window.innerHeight - containerHeight));
      onPositionChange({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(dragRef.current.startPosX + dx, window.innerWidth - containerWidth));
      const newY = Math.max(0, Math.min(dragRef.current.startPosY + dy, window.innerHeight - containerHeight));
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      onCommit({ x: newX, y: newY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [position.x, position.y, containerWidth, containerHeight, onPositionChange, onCommit]);

  return { onMouseDown: handleMouseDown };
}
