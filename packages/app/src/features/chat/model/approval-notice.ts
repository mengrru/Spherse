import type { ChatSessionData } from "../types";

export interface PendingApproval {
  kind: "approval" | "question";
  requestId: string;
  sessionId: string;
  projectId: string;
  toolName: string;
}

export function collectPendingApprovals(
  sessions: Record<string, { data: ChatSessionData; projectId: string }>,
): PendingApproval[] {
  const result: PendingApproval[] = [];
  for (const [sessionId, session] of Object.entries(sessions)) {
    for (const interaction of Object.values(session.data.interactions)) {
      if (interaction.status.type !== "pending") continue;
      result.push({
        kind: interaction.kind,
        requestId: interaction.requestId,
        sessionId,
        projectId: session.projectId,
        toolName: interaction.toolName,
      });
    }
  }
  return result;
}
