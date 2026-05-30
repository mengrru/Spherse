import { useEffect, useRef } from "react";
import { Button } from "./ui/button";
import { MessageCircleIcon } from "lucide-react";

interface TextSelectionToolbarProps {
  position: { x: number; y: number }
  onAction: () => void
  onClose: () => void
}

export function TextSelectionToolbar({ position, onAction, onClose }: TextSelectionToolbarProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <Button
      ref={ref}
      variant="secondary"
      size="sm"
      className="fixed z-50 shadow-lg"
      style={{
        left: position.x,
        top: position.y,
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onAction();
      }}
    >
      <MessageCircleIcon />
      发起会话
    </Button>
  );
}
