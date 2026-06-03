import { useRef } from "react";
import { Button } from "../../components/ui/button";
import { useDismissable } from "../../hooks/useDismissable";
import { MessageCircleIcon } from "lucide-react";

interface StartSessionButtonProps {
  position: { x: number; y: number };
  onStart: () => void;
  onClose: () => void;
}

export function StartSessionButton({ position, onStart, onClose }: StartSessionButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useDismissable({ ref, onDismiss: onClose });

  return (
    <Button
      ref={ref}
      variant="secondary"
      size="sm"
      className="fixed z-50 -translate-x-1/2 border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-border/60 hover:bg-popover"
      style={{
        left: position.x,
        top: position.y,
      }}
      data-testid="text-selection-start-button"
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onStart();
      }}
    >
      <MessageCircleIcon className="size-3.5" />
      发起会话
    </Button>
  );
}
