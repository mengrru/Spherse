import { useState, useEffect, useRef, type ReactNode, type MouseEvent } from "react";
import { XIcon } from "lucide-react";

interface DraggableWindowProps {
  children: ReactNode;
  onClose: () => void;
  title: string;
}

export function DraggableWindow({ children, onClose, title }: DraggableWindowProps) {
  const [position, setPosition] = useState({ x: window.innerWidth - 520, y: window.innerHeight - 380 });
  const [size] = useState({ w: 500, h: 360 });
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      });
    };
    const handleMouseUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = (e: MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
  };

  return (
    <div
      className="fixed z-50 flex flex-col bg-card border border-border rounded-lg shadow-lg overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
      }}
    >
      <div
        className="flex items-center px-3 py-1.5 border-b border-border cursor-move select-none bg-muted/30"
        onMouseDown={handleMouseDown}
      >
        <span className="text-xs font-medium">{title}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="h-5 w-5 inline-flex items-center justify-center rounded-sm hover:bg-muted-foreground/10"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}
