import { useCallback, useId, useRef, type ReactNode, type RefObject } from "react";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useSplitPaneAvailable } from "./hooks";
import { clampRatio } from "./layout";
import { SplitPaneView } from "./SplitPaneView";
import { useSplitPaneStore, type SplitPaneState } from "./store";
import { useElementWidth } from "./use-element-width";
import { useSplitDivider } from "./use-split-divider";

export function SplitLayout({ children }: { children: ReactNode }) {
  const { projectId } = useProjectCtx();
  const available = useSplitPaneAvailable();
  const split = useSplitPaneStore((s) => s.byProject[projectId]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={containerRef} data-split-layout className="flex min-h-0 flex-1 overflow-hidden">
      <div data-split-main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      {available && split && (
        <SplitRegion key={projectId} projectId={projectId} split={split} containerRef={containerRef} />
      )}
    </div>
  );
}

interface SplitRegionProps {
  projectId: string;
  split: SplitPaneState;
  containerRef: RefObject<HTMLDivElement | null>;
}

function SplitRegion({ projectId, split, containerRef }: SplitRegionProps) {
  const { t } = useI18n();
  const paneId = useId();
  const containerWidth = useElementWidth(containerRef);
  const commit = useCallback((ratio: number) => useSplitPaneStore.getState().setRatio(projectId, ratio), [projectId]);
  const storedRatio = clampRatio(split.ratio, containerWidth);
  const divider = useSplitDivider({ containerRef, ratio: storedRatio, containerWidth, onCommit: commit });
  const ratio = divider.dragRatio ?? storedRatio;
  const mainPercent = Math.round((1 - ratio) * 100);

  return (
    <>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t("split-pane.resize")}
        aria-controls={paneId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={mainPercent}
        data-split-divider
        data-dragging={divider.dragging || undefined}
        className="relative w-px shrink-0 cursor-col-resize touch-none bg-border transition-colors before:absolute before:inset-y-0 before:-inset-x-1 hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none data-[dragging]:bg-primary/60"
        onPointerDown={divider.onPointerDown}
        onKeyDown={divider.onKeyDown}
        onDoubleClick={divider.onDoubleClick}
      />
      {divider.dragging && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}
      <aside
        id={paneId}
        data-split-pane
        className="flex min-w-0 shrink-0 flex-col overflow-hidden"
        style={{ flexBasis: `${ratio * 100}%` }}
      >
        <SplitPaneView target={split.target} />
      </aside>
    </>
  );
}
