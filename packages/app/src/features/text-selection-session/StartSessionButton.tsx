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
      className="fixed z-50 shadow-lg"
      style={{
        left: position.x,
        top: position.y,
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onStart();
      }}
    >
      <MessageCircleIcon />
      发起会话
    </Button>
  );
}
