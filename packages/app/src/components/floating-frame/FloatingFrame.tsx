import { useState } from "react";
import type { ReactNode } from "react";
import { XIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { useSidePanelStore } from "../../stores/side-panel-store";
import { useDrag } from "./use-drag";
import { useResize, type ResizeEdge } from "./use-resize";
import { FLOAT_MIN_WIDTH, FLOAT_MIN_HEIGHT } from "./defaults";

const edges: Array<{ edge: ResizeEdge; className: string }> = [
  { edge: "n", className: "top-0 left-1.5 right-1.5 h-1.5 cursor-n-resize" },
  { edge: "s", className: "bottom-0 left-1.5 right-1.5 h-1.5 cursor-s-resize" },
  { edge: "w", className: "left-0 top-1.5 bottom-1.5 w-1.5 cursor-w-resize" },
  { edge: "e", className: "right-0 top-1.5 bottom-1.5 w-1.5 cursor-e-resize" },
  { edge: "nw", className: "top-0 left-0 w-1.5 h-1.5 cursor-nw-resize" },
  { edge: "ne", className: "top-0 right-0 w-1.5 h-1.5 cursor-ne-resize" },
  { edge: "sw", className: "bottom-0 left-0 w-1.5 h-1.5 cursor-sw-resize" },
  { edge: "se", className: "bottom-0 right-0 w-1.5 h-1.5 cursor-se-resize" },
];

interface FloatingFrameProps {
  hookPrefix: string;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionCommit: (pos: { x: number; y: number }) => void;
  onSizeCommit: (size: { width: number; height: number }, pos: { x: number; y: number }) => void;
  onClose: () => void;
  onExpand?: () => void;
  children: ReactNode;
}

export function FloatingFrame({
  hookPrefix,
  title,
  position: initialPosition,
  size: initialSize,
  onPositionCommit,
  onSizeCommit,
  onClose,
  onExpand,
  children,
}: FloatingFrameProps) {
  const { t } = useI18n();
  const pinned = useSidePanelStore((s) => s.pinned);
  const [position, setPosition] = useState(initialPosition);
  const [size, setSize] = useState(initialSize);

  const closeSelector = `[data-${hookPrefix}-float-close]`;
  const rootAttr = { [`data-${hookPrefix}-float-root`]: true };
  const titlebarAttr = { [`data-${hookPrefix}-float-titlebar`]: true };
  const closeAttr = { [`data-${hookPrefix}-float-close`]: true };

  const drag = useDrag({
    position,
    onPositionChange: setPosition,
    onCommit: onPositionCommit,
    containerWidth: size.width,
    containerHeight: size.height,
    ignoreSelector: closeSelector,
  });

  const { createHandler } = useResize({
    size,
    position,
    onSizeChange: setSize,
    onPositionChange: setPosition,
    onCommit: onSizeCommit,
    minWidth: FLOAT_MIN_WIDTH,
    minHeight: FLOAT_MIN_HEIGHT,
  });

  return (
    <div
      {...rootAttr}
      className={`fixed ${pinned ? "z-50" : "z-30"} flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg`}
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      <div
        {...titlebarAttr}
        className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5 cursor-move select-none"
        onPointerDown={drag.onPointerDown}
        onDoubleClick={onExpand}
      >
        <span className="text-xs font-medium truncate">{title}</span>
        <div className="ml-auto" onDoubleClick={(e) => e.stopPropagation()}>
          <button
            {...closeAttr}
            onClick={onClose}
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm hover:bg-muted-foreground/10"
            aria-label={t("common.close")}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
      {edges.map(({ edge, className }) => (
        <div
          key={edge}
          className={`absolute ${className}`}
          onPointerDown={createHandler(edge)}
        />
      ))}
    </div>
  );
}
