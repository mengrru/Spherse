import { createPortal } from "react-dom";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import type { AgentProfile } from "../../lib/types";
import { Chat } from "../chat";
import { FloatingChatFrame } from "./FloatingChatFrame";
import { useFloatingChatStore, type FloatingChatState } from "./store";
import { useProjectCtx } from "../../context/project-context";
import { useBusSubscription } from "../../hooks/useBusSubscription";

interface FloatingChatContainerProps {
  projectId: string;
  floatingChat: FloatingChatState;
  agent: AgentProfile;
}

export function FloatingChatContainer({
  projectId,
  floatingChat,
  agent,
}: FloatingChatContainerProps) {
  const { client } = useProjectCtx();
  const navigate = useNavigate();
  const setFloatingChat = useFloatingChatStore((s) => s.setFloatingChat);
  const [themeCss, setThemeCss] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.getAgentTheme(agent.id).then((css) => {
      if (cancelled) return;
      setThemeCss(css.trim() ? css : null);
    });
    return () => { cancelled = true; };
  }, [client, agent.id]);

  useBusSubscription(projectId, "fs-watch", (_type, payload) => {
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (!changedPath || !changedPath.includes("agents/") || !changedPath.endsWith("theme.css")) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      client.getAgentTheme(agent.id).then((css) => {
        setThemeCss(css.trim() ? css : null);
      });
    }, 250);
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

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
      {themeCss && <style>{themeCss}</style>}
      <FloatingChatFrame
        title={agent.name}
        position={floatingChat.position}
        size={floatingChat.size}
        onPositionCommit={handlePositionCommit}
        onSizeCommit={handleSizeCommit}
        onClose={handleClose}
      >
        <Chat
          sessionId={floatingChat.sessionId}
          agent={agent}
          hideHeader
          onNavigateToPath={(path) => {
            navigate(`/project/${projectId}/content?path=${encodeURIComponent(path)}`);
          }}
        />
      </FloatingChatFrame>
    </div>,
    document.body,
  );
}
