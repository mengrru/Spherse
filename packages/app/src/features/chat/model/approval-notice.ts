import type { ChatMessage } from "../types";

export interface PendingApproval {
  kind: "approval" | "question";
  requestId: string;
  sessionId: string;
  projectId: string;
  toolName: string;
  command?: string;
}

export function collectPendingApprovals(
  sessions: Record<string, { messages: ChatMessage[]; projectId: string }>,
): PendingApproval[] {
  const result: PendingApproval[] = [];
  for (const [sessionId, session] of Object.entries(sessions)) {
    for (const message of session.messages) {
      if (message.role !== "assistant" || !message._toolCalls) continue;
      for (const toolCall of message._toolCalls) {
        const card = toolCall._card;
        if (!card) continue;
        if (card.type === "command") {
          if (card.requestId) {
            result.push({
              kind: "approval",
              requestId: card.requestId,
              sessionId,
              projectId: session.projectId,
              toolName: toolCall.toolName,
              command: card.command,
            });
          }
        } else if (card.type === "approval") {
          if (card.requestId) {
            result.push({
              kind: "approval",
              requestId: card.requestId,
              sessionId,
              projectId: session.projectId,
              toolName: toolCall.toolName,
            });
          }
        } else if (card.type === "question") {
          if (card.requestId) {
            result.push({
              kind: "question",
              requestId: card.requestId,
              sessionId,
              projectId: session.projectId,
              toolName: toolCall.toolName,
            });
          }
        }
      }
    }
  }
  return result;
}
