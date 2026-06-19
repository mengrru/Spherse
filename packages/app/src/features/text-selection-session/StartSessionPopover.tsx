import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import type { AgentProfile, ActiveSessionInfo } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { useDismissable } from "../../hooks/useDismissable";
import { dispatchAction } from "../../ui-sdk";

interface StartSessionPopoverProps {
  selectedText: string;
  sourcePath: string;
  agents: AgentProfile[];
  position: { x: number; y: number };
  projectId: string;
  activeSessions?: ActiveSessionInfo[];
  onSubmit: (agentId: string, comment?: string) => void;
  onClose: () => void;
}

const MAX_PREVIEW_LENGTH = 200;

const POPOVER_WIDTH = 300;
const VIEWPORT_PADDING = 8;
const POPOVER_MAX_HEIGHT = 420;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function getPopoverPosition(position: { x: number; y: number }) {
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2);
  const maxHeight = Math.min(POPOVER_MAX_HEIGHT, window.innerHeight - VIEWPORT_PADDING * 2);
  const left = clamp(
    position.x - width / 2,
    VIEWPORT_PADDING,
    window.innerWidth - width - VIEWPORT_PADDING,
  );
  const top = clamp(
    position.y + 40,
    VIEWPORT_PADDING,
    window.innerHeight - maxHeight - VIEWPORT_PADDING,
  );
  return {
    left,
    top,
    width,
    maxHeight,
  };
}

export function StartSessionPopover({
  selectedText,
  sourcePath,
  agents,
  position,
  projectId,
  activeSessions,
  onSubmit,
  onClose,
}: StartSessionPopoverProps) {
  const [comment, setComment] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const navigate = useNavigate();
  useDismissable({ ref, onDismiss: onClose });

  const previewText =
    selectedText.length > MAX_PREVIEW_LENGTH
      ? selectedText.slice(0, MAX_PREVIEW_LENGTH) + "..."
      : selectedText;
  const trimmedComment = comment.trim();

  const handleSendToSession = (sessionId: string) => {
    const quotedText = selectedText.split("\n").map((line) => `> ${line}`).join("\n");
    const parts = [t("text-selection.promptPrefix", { path: sourcePath, text: quotedText })];
    if (trimmedComment) parts.push(`\n\n${trimmedComment}`);
    const message = parts.join("");
    dispatchAction("sendMessage", { sessionId, message }, { navigate, projectId });
    onClose();
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
      style={getPopoverPosition(position)}
      data-testid="text-selection-popover"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <div className="mb-2 text-[11px] text-muted-foreground">
          {t("text-selection.quoteFrom", { path: sourcePath })}
        </div>
        <div className="mb-2 max-h-20 overflow-y-auto rounded-r border-l-2 border-primary bg-muted p-2 font-mono text-xs leading-relaxed">
          {previewText}
        </div>
        <Textarea
          className="mb-2 h-12 resize-y"
          placeholder={t("text-selection.supplementPlaceholder")}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 240 }} data-testid="text-selection-agent-list">
          {activeSessions && activeSessions.length > 0 && (
            <>
              {activeSessions.map((session) => (
                <Button
                  key={session.sessionId}
                  variant="ghost"
                  className="w-full justify-between"
                  onClick={() => handleSendToSession(session.sessionId)}
                >
                  <span>
                    {session.agentName}
                    {session.sessionTitle && (
                      <>
                        <span className="text-border">|</span>
                        {session.sessionTitle}
                      </>
                    )}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {session.floating
                      ? t("text-selection.sendToFloatingSession")
                      : t("text-selection.sendToCurrentSession")}
                  </span>
                </Button>
              ))}
              <div className="my-1 border-t border-border" />
            </>
          )}
          {agents.map((agent) => (
            <Button
              key={agent.id}
              variant="ghost"
              className="w-full justify-between"
              onClick={() => onSubmit(agent.id, trimmedComment || undefined)}
            >
              <span>{agent.name}</span>
              <span className="text-[11px] text-muted-foreground">{t("common.send")}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
