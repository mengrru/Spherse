import type { RefObject } from "react";
import type { AgentProfile, ChatMessage } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { ChevronDownIcon } from "lucide-react";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  messages: ChatMessage[];
  agent: AgentProfile;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  onScrollToBottom: () => void;
  onNavigateToPath?: (path: string) => void;
}

export function MessageList({ messages, agent, messagesEndRef, containerRef, isAtBottom, onScrollToBottom, onNavigateToPath }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
        <div className="text-muted-foreground text-sm font-medium">{agent.name}</div>
        <div className="text-muted-foreground text-sm">发送一条消息开始对话</div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className="h-full overflow-y-auto p-4 flex flex-col gap-3">
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
      {!isAtBottom && (
        <div className="absolute bottom-4 right-4">
          <Button
            variant="outline"
            size="icon-lg"
            className="rounded-full bg-background shadow-md"
            onClick={onScrollToBottom}
          >
            <ChevronDownIcon />
          </Button>
        </div>
      )}
    </div>
  );
}
