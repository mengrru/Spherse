import { useRef, useState } from "react";
import type { AgentProfile } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { useDismissable } from "../../hooks/useDismissable";

interface StartSessionPopoverProps {
  selectedText: string;
  sourcePath: string;
  agents: AgentProfile[];
  position: { x: number; y: number };
  onSubmit: (agentId: string, comment?: string) => void;
  onClose: () => void;
}

const MAX_PREVIEW_LENGTH = 200;

function getPopoverPosition(position: { x: number; y: number }) {
  return {
    left: Math.max(8, Math.min(position.x - 100, window.innerWidth - 420)),
    top: Math.max(8, Math.min(position.y, window.innerHeight - 296)),
    maxWidth: 400,
    maxHeight: window.innerHeight - 16,
    width: "max-content",
  };
}

export function StartSessionPopover({
  selectedText,
  sourcePath,
  agents,
  position,
  onSubmit,
  onClose,
}: StartSessionPopoverProps) {
  const [comment, setComment] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismissable({ ref, onDismiss: onClose });

  const previewText =
    selectedText.length > MAX_PREVIEW_LENGTH
      ? selectedText.slice(0, MAX_PREVIEW_LENGTH) + "..."
      : selectedText;
  const trimmedComment = comment.trim();

  return (
    <div
      ref={ref}
      className="fixed z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
      style={getPopoverPosition(position)}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="p-3 overflow-y-auto">
        <div className="mb-2 text-[11px] text-muted-foreground">
          引用自 <span className="font-mono">{sourcePath}</span>
        </div>
        <div className="mb-2 max-h-20 overflow-y-auto rounded-r border-l-2 border-primary bg-muted p-2 font-mono text-xs leading-relaxed">
          {previewText}
        </div>
        {trimmedComment && (
          <div className="mb-2 max-h-16 overflow-y-auto text-xs leading-relaxed text-muted-foreground">
            {trimmedComment}
          </div>
        )}

        <Textarea
          className="h-12 resize-y"
          placeholder="添加补充说明（可选）..."
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[11px] text-muted-foreground">选择 Agent</div>
          <div className="flex flex-col gap-0.5">
            {agents.map((agent) => (
              <Button
                key={agent.id}
                variant="ghost"
                className="w-full justify-between"
                onClick={() => onSubmit(agent.id, trimmedComment || undefined)}
              >
                <span>{agent.name}</span>
                <span className="text-[11px] text-muted-foreground">发送</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
