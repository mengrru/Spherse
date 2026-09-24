import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useProjectCtx } from "../../context/project-context";
import { SelectionHighlightOverlay } from "./SelectionHighlightOverlay";
import { TextSelectionToolbar } from "./TextSelectionToolbar";
import { StartSessionPopover } from "./StartSessionPopover";
import { useTextSelection } from "./hooks/useTextSelection";
import { useSelectionSessionHandlers } from "./use-selection-session-handlers";

export interface TextSelectionSessionProps {
  children: (contentRef: RefObject<HTMLDivElement | null>) => ReactNode;
  disabled: boolean;
  sourcePath: string;
}

export function TextSelectionSession({
  children,
  disabled,
  sourcePath,
}: TextSelectionSessionProps) {
  const { projectId } = useProjectCtx();
  const { agents, activeSessions, onStartSession } = useSelectionSessionHandlers();
  const [showStartPopover, setShowStartPopover] = useState(false);
  const { contentRef, selectionState, setSelectionState } = useTextSelection({
    disabled: disabled || showStartPopover,
  });

  const clearSelection = () => {
    setSelectionState(null);
  };

  useEffect(() => {
    if (!selectionState) setShowStartPopover(false);
  }, [selectionState]);

  return (
    <>
      {children(contentRef)}
      {selectionState && !showStartPopover && (
        <TextSelectionToolbar
          position={selectionState.position}
          selectedText={selectionState.text}
          onStart={() => setShowStartPopover(true)}
          onCopy={clearSelection}
          onClose={clearSelection}
        />
      )}
      {selectionState && (
        <SelectionHighlightOverlay rects={selectionState.highlightRects} />
      )}
      {selectionState && showStartPopover && (
        <StartSessionPopover
          selectedText={selectionState.text}
          sourcePath={sourcePath}
          agents={agents}
          position={selectionState.position}
          projectId={projectId}
          activeSessions={activeSessions}
          onSubmit={(agentId, comment) => {
            void onStartSession(agentId, selectionState.text, sourcePath, comment);
            setShowStartPopover(false);
            clearSelection();
          }}
          onClose={() => {
            setShowStartPopover(false);
            clearSelection();
          }}
        />
      )}
    </>
  );
}
