import { createPortal } from "react-dom";

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SelectionHighlightOverlayProps {
  rects: HighlightRect[];
}

export function SelectionHighlightOverlay({ rects }: SelectionHighlightOverlayProps) {
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-40" data-testid="text-selection-highlight">
      {rects.map((rect, index) => (
        <div
          key={`${rect.left}-${rect.top}-${rect.width}-${rect.height}-${index}`}
          className="absolute rounded-[1px] bg-primary/20"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </div>,
    document.body,
  );
}
