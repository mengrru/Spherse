import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import type { AgentSummary } from "../../lib/types";
import { FloatingFrame } from "../../components/floating-frame";
import { Chat } from "../chat";
import { useFloatingChatStore, type FloatingChatState } from "./store";

interface FloatingChatContainerProps {
  projectId: string;
  floatingChat: FloatingChatState;
  agent: AgentSummary;
}

export function FloatingChatContainer({
  projectId,
  floatingChat,
  agent,
}: FloatingChatContainerProps) {
  const navigate = useNavigate();
  const setFloatingChat = useFloatingChatStore((s) => s.setFloatingChat);

  const handleClose = () => {
    setFloatingChat(projectId, null);
  };

  const handleExpand = () => {
    setFloatingChat(projectId, null);
    navigate(`/project/${projectId}/chat/${floatingChat.sessionId}`);
  };

  const handlePositionCommit = (pos: { x: number; y: number }) => {
    setFloatingChat(projectId, { ...floatingChat, position: pos });
  };

  const handleSizeCommit = (size: { width: number; height: number }, pos: { x: number; y: number }) => {
    setFloatingChat(projectId, { ...floatingChat, position: pos, size });
  };

  return createPortal(
    <div className="floating-chat-portal">
      <FloatingFrame
        hookPrefix="chat"
        title={agent.name}
        position={floatingChat.position}
        size={floatingChat.size}
        onPositionCommit={handlePositionCommit}
        onSizeCommit={handleSizeCommit}
        onClose={handleClose}
        onExpand={handleExpand}
      >
        <Chat
          key={floatingChat.sessionId}
          sessionId={floatingChat.sessionId}
          agent={agent}
          hideHeader
          onNavigateToPath={(path) => {
            navigate(`/project/${projectId}/content?path=${encodeURIComponent(path)}`);
          }}
        />
      </FloatingFrame>
    </div>,
    document.body,
  );
}
