import { useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";
import { useDismissable } from "../../hooks/useDismissable";
import { CopyIcon, MessageCircleIcon } from "lucide-react";

interface TextSelectionToolbarProps {
  position: { x: number; y: number };
  selectedText: string;
  onStart: () => void;
  onCopy: () => void;
  onClose: () => void;
}

export function TextSelectionToolbar({ position, selectedText, onStart, onCopy, onClose }: TextSelectionToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useDismissable({ ref, onDismiss: onClose });

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 flex -translate-x-1/2 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-border/60"
      style={{ left: position.x, top: position.y }}
      data-testid="text-selection-toolbar"
      onMouseUp={(e) => e.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 rounded-none px-2 text-xs hover:bg-accent"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          navigator.clipboard.writeText(selectedText).then(() => {
            onCopy();
          }).catch(() => {});
        }}
        title={t("text-selection.copy")}
      >
        <CopyIcon className="size-3.5" />
      </Button>
      <div className="w-px bg-border" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 rounded-none px-2 text-xs hover:bg-accent"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          onStart();
        }}
      >
        <MessageCircleIcon className="size-3.5" />
        {t("text-selection.startSession")}
      </Button>
    </div>,
    document.body,
  );
}
