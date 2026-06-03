import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { AgentProfile } from "../../lib/types";
import { SelectionHighlightOverlay } from "./SelectionHighlightOverlay";
import { StartSessionButton } from "./StartSessionButton";
import { StartSessionPopover } from "./StartSessionPopover";
import { useTextSelection } from "./hooks/useTextSelection";

export interface TextSelectionSessionProps {
  children: (contentRef: RefObject<HTMLDivElement | null>) => ReactNode;
  disabled: boolean;
  sourcePath: string;
  agents: AgentProfile[];
  onStartSession?: (agentId: string, selectedText: string, sourcePath: string, comment?: string) => void;
}

export function TextSelectionSession({
  children,
  disabled,
  sourcePath,
  agents,
  onStartSession,
}: TextSelectionSessionProps) {
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
        <StartSessionButton
          position={selectionState.position}
          onStart={() => setShowStartPopover(true)}
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
          onSubmit={(agentId, comment) => {
            onStartSession?.(agentId, selectionState.text, sourcePath, comment);
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
