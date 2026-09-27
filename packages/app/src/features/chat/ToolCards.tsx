import type { ToolItem } from "./model/tool-item";
import { HtmlCardRenderer } from "./HtmlCard";
import { ImageCardRenderer } from "./ImageCard";
import { CommandCardRenderer } from "./CommandCard";
import { ApprovalCardRenderer } from "./ApprovalCard";
import { QuestionCardRenderer } from "./QuestionCard";
import { formatMessageTime } from "./lib/format-time";

interface ToolCardsProps {
  tools: ToolItem[];
  timestamp?: number;
  showTime?: boolean;
  supersededToolCallIds?: Set<string>;
  onRespondApproval?: (requestId: string, approved: boolean) => void;
  onRespondQuestion?: (requestId: string, answer: string) => boolean | void;
}

export function ToolCards({ tools, timestamp, showTime, supersededToolCallIds, onRespondApproval, onRespondQuestion }: ToolCardsProps) {
  return (
    <div className="group flex w-full min-w-0 items-start gap-1.5" data-chat-cards>
      <div className="flex w-full min-w-0 flex-col gap-1">
        {tools.map((tool) => {
          const card = tool.card;
          if (!card) return null;
          if (card.type === "html") {
            return (
              <HtmlCardRenderer
                key={tool.toolCallId}
                card={card}
                defaultCollapsed={supersededToolCallIds?.has(tool.toolCallId) ?? false}
              />
            );
          }
          if (card.type === "command") {
            return <CommandCardRenderer key={tool.toolCallId} card={card} onRespondApproval={onRespondApproval} />;
          }
          if (card.type === "approval") {
            return <ApprovalCardRenderer key={tool.toolCallId} card={card} onRespondApproval={onRespondApproval} />;
          }
          if (card.type === "image") {
            return <ImageCardRenderer key={tool.toolCallId} card={card} />;
          }
          if (card.type === "question") {
            return <QuestionCardRenderer key={tool.toolCallId} card={card} onRespondQuestion={onRespondQuestion} />;
          }
          return null;
        })}
      </div>
      {showTime && timestamp && (
        <time className="pt-0.5 text-[11px] text-muted-foreground whitespace-nowrap opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
          {formatMessageTime(timestamp)}
        </time>
      )}
    </div>
  );
}
