import { useEffect, useRef, useState } from "react";

export interface SelectionState {
  text: string;
  position: { x: number; y: number };
}

export function useTextSelection({
  disabled,
}: {
  disabled: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);

  useEffect(() => {
    if (disabled) return;

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionState(null);
        return;
      }

      const contentEl = contentRef.current;
      if (!contentEl) return;

      const range = selection.getRangeAt(0);
      if (!contentEl.contains(range.commonAncestorContainer)) return;

      const text = selection.toString().trim();
      const endRange = range.cloneRange();
      endRange.collapse(false);
      const endRect = endRange.getBoundingClientRect();
      const y = endRect.top > 50 ? endRect.top - 36 : endRect.bottom + 4;

      setSelectionState({
        text,
        position: { x: endRect.left, y },
      });
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [disabled]);

  return {
    contentRef,
    selectionState,
    setSelectionState,
  };
}
