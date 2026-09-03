import type { ChatCard } from "./types";
import { HtmlCardRenderer } from "./HtmlCard";
import { ImageCardRenderer } from "./ImageCard";
import { CommandCardRenderer } from "./CommandCard";
import { ApprovalCardRenderer } from "./ApprovalCard";
import { QuestionCardRenderer } from "./QuestionCard";
import { useChatActions } from "./chat-actions-context";

interface CardRendererProps {
  card: ChatCard;
  superseded?: boolean;
}

export function CardRenderer({ card, superseded }: CardRendererProps) {
  const actions = useChatActions();
  switch (card.type) {
    case "html":
      return <HtmlCardRenderer card={card} defaultCollapsed={superseded ?? false} />;
    case "image":
      return <ImageCardRenderer card={card} />;
    case "command":
      return <CommandCardRenderer card={card} onRespondApproval={actions.respondApproval} />;
    case "approval":
      return <ApprovalCardRenderer card={card} onRespondApproval={actions.respondApproval} />;
    case "question":
      return <QuestionCardRenderer card={card} onRespondQuestion={actions.respondQuestion} />;
  }
}
