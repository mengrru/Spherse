import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import type { ApiClient } from "../../lib/api";
import type { AgentProfile } from "../../lib/types";
import { Chat } from "../chat";
import { FloatingChatFrame } from "./FloatingChatFrame";
import { useProjectUiStore, type FloatingChatState } from "../../stores/project-ui-store";

function scopeCssToFloat(css: string): string {
  const SCOPE = "[data-chat-float-root]";
  const lines = css.split("\n");
  const result: string[] = [];
  let inBlock = 0;
  let buffer = "";

  for (const line of lines) {
    for (const ch of line) {
      if (ch === "{") inBlock++;
      else if (ch === "}") inBlock--;
    }
    buffer += line + "\n";
    if (inBlock === 0 && buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("@")) {
        result.push(trimmed);
      } else if (trimmed.startsWith("--") || /^[a-z-]+\s*:/.test(trimmed)) {
        result.push(`${SCOPE} { ${trimmed} }`);
      } else {
        const scoped = trimmed.replace(
          /^([^@{}/]+?)(\s*\{)/gm,
          (_, selectors, brace) => {
            const prefixed = selectors
              .split(",")
              .map((s: string) => `${SCOPE} ${s.trim()}`)
              .join(", ");
            return `${prefixed}${brace}`;
          },
        );
        result.push(scoped);
      }
      buffer = "";
    }
  }
  if (buffer.trim()) result.push(`${SCOPE} { ${buffer.trim()} }`);
  return result.join("\n\n");
}

interface FloatingChatContainerProps {
  projectId: string;
  floatingChat: FloatingChatState;
  agent: AgentProfile;
  client: ApiClient;
  baseUrl: string;
}

export function FloatingChatContainer({
  projectId,
  floatingChat,
  agent,
  client,
  baseUrl,
}: FloatingChatContainerProps) {
  const setFloatingChat = useProjectUiStore((s) => s.setFloatingChat);
  const [scopedThemeCss, setScopedThemeCss] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.getAgentTheme(agent.id).then((css) => {
      if (cancelled) return;
      if (css.trim()) {
        setScopedThemeCss(scopeCssToFloat(css));
      } else {
        setScopedThemeCss(null);
      }
    });
    return () => { cancelled = true; };
  }, [client, agent.id]);

  const handleClose = () => {
    setFloatingChat(projectId, null);
  };

  const handlePositionCommit = (pos: { x: number; y: number }) => {
    setFloatingChat(projectId, { ...floatingChat, position: pos });
  };

  const handleSizeCommit = (size: { width: number; height: number }, pos: { x: number; y: number }) => {
    setFloatingChat(projectId, { ...floatingChat, position: pos, size });
  };

  return createPortal(
    <div className="floating-chat-portal">
      {scopedThemeCss && <style>{scopedThemeCss}</style>}
      <FloatingChatFrame
        title={agent.name}
        position={floatingChat.position}
        size={floatingChat.size}
        onPositionCommit={handlePositionCommit}
        onSizeCommit={handleSizeCommit}
        onClose={handleClose}
      >
        <Chat
          client={client}
          sessionId={floatingChat.sessionId}
          baseUrl={baseUrl}
          projectId={projectId}
          agent={agent}
          hideHeader
        />
      </FloatingChatFrame>
    </div>,
    document.body,
  );
}
