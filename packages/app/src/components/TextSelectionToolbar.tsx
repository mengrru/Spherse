import { useRef } from "react";
import { Button } from "./ui/button";
import { MessageCircleIcon } from "lucide-react";
import { useDismissable } from "../hooks/useDismissable";

interface TextSelectionToolbarProps {
  position: { x: number; y: number }
  onAction: () => void
  onClose: () => void
}

export function TextSelectionToolbar({ position, onAction, onClose }: TextSelectionToolbarProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useDismissable({ ref, onDismiss: onClose });

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
