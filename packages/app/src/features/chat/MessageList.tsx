import type { RefObject } from "react";
import type { AgentProfile, ChatMessage } from "../../lib/types";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  messages: ChatMessage[];
  agent: AgentProfile;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onNavigateToPath?: (path: string) => void;
}

export function MessageList({ messages, agent, messagesEndRef, onNavigateToPath }: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {messages.map((message, index) => (
        <MessageItem
          key={index}
          message={message}
          agent={agent}
          onNavigateToPath={onNavigateToPath}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}
