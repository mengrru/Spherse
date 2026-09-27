import type { ToolItem } from "./model/tool-item";
import { HtmlCardRenderer } from "./HtmlCard";
import { ImageCardRenderer } from "./ImageCard";
import { CommandCardRenderer } from "./CommandCard";
import { ApprovalCardRenderer } from "./ApprovalCard";
import { QuestionCardRenderer } from "./QuestionCard";

interface ToolCardsProps {
  tools: ToolItem[];
  supersededToolCallIds?: Set<string>;
  onRespondApproval?: (requestId: string, approved: boolean) => void;
  onRespondQuestion?: (requestId: string, answer: string) => boolean | void;
}

export function ToolCards({ tools, supersededToolCallIds, onRespondApproval, onRespondQuestion }: ToolCardsProps) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-1" data-chat-cards>
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
  );
}
