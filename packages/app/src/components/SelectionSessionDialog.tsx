import { useState, useEffect, useRef } from "react";
import type { AgentProfile } from "../lib/types";

interface SelectionSessionDialogProps {
  selectedText: string
  sourcePath: string
  agents: AgentProfile[]
  position: { x: number; y: number }
  onSubmit: (agentId: string, comment?: string) => void
  onClose: () => void
}

const MAX_PREVIEW_LENGTH = 200;

export function SelectionSessionDialog({
  selectedText,
  sourcePath,
  agents,
  position,
  onSubmit,
  onClose,
}: SelectionSessionDialogProps) {
  const [phase, setPhase] = useState<"compose" | "select-agent">("compose");
  const [comment, setComment] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const previewText =
    selectedText.length > MAX_PREVIEW_LENGTH
      ? selectedText.slice(0, MAX_PREVIEW_LENGTH) + "..."
      : selectedText;

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface border border-[var(--border)] rounded-lg shadow-xl"
      style={{
        left: Math.max(8, Math.min(position.x - 100, window.innerWidth - 420)),
        top: Math.max(8, Math.min(position.y, window.innerHeight - 296)),
        maxWidth: 400,
        maxHeight: window.innerHeight - 16,
        width: "max-content",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-3 overflow-y-auto">
        <div className="text-[11px] text-[var(--secondary)] mb-2">
          引用自 <span className="font-mono">{sourcePath}</span>
        </div>
        <div className="border-l-3 border-[var(--accent)] bg-[var(--muted-bg)] rounded-r p-2 text-[12px] font-mono max-h-[80px] overflow-y-auto mb-2 leading-relaxed">
          {previewText}
        </div>

        {phase === "compose" ? (
          <>
            <textarea
              className="w-full h-[48px] p-2 text-[13px] bg-[var(--input-bg)] border border-[var(--border-input)] rounded resize-y box-border outline-none focus:border-accent"
              placeholder="添加补充说明（可选）..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="flex justify-end mt-2">
              <button
                className="px-3 py-1.5 text-[12px] bg-accent text-white rounded hover:bg-accent-hover transition-colors"
                onClick={() => setPhase("select-agent")}
              >
                发送 ➤
              </button>
            </div>
          </>
        ) : (
          <div className="mt-1 border-t border-[var(--border)] pt-2">
            <div className="text-[11px] text-[var(--secondary)] mb-1">选择 Agent</div>
            <div className="flex flex-col gap-0.5">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  className="w-full px-2 py-1.5 text-left text-[13px] rounded hover:bg-[var(--hover)] transition-colors flex justify-between items-center"
                  onClick={() => onSubmit(agent.id, comment || undefined)}
                >
                  <span>{agent.name}</span>
                  <span className="text-[11px] text-[var(--secondary)]">发送</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
