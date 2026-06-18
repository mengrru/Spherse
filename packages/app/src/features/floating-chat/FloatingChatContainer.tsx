import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import type { ApiClient } from "../../lib/api";
import type { AgentProfile } from "../../lib/types";
import { Chat } from "../chat";
import { FloatingChatFrame } from "./FloatingChatFrame";
import { useProjectUiStore, type FloatingChatState } from "../../stores/project-ui-store";
import { scopeCss } from "../../lib/scope-css";

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
        setScopedThemeCss(scopeCss(css, "[data-chat-float-root]"));
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
