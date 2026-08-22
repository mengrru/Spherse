import { useBusSubscription } from "./useBusSubscription";
import { useReconnectedSync } from "./useReconnectedSync";
import type { ApiClient } from "../lib/api";
import { refreshProjectAgents, refreshProjectSessions } from "../queries/project";

/**
 * Keeps the cached agent list in sync when agents are created/updated/deleted outside the UI
 * (e.g. by an agent calling the `manage_agent` tool).
 */
export function useAgentBusRefresh(projectId: string | undefined, client: ApiClient | null): void {
  useBusSubscription(projectId ?? "", "agent", (type, payload) => {
    if (type !== "agent_updated" || !projectId || !client) return;
    void refreshProjectAgents(projectId).then(() => {
      const action = (payload as { action?: string }).action;
      if (action === "created" || action === "deleted") {
        void refreshProjectSessions(projectId);
      }
    });
  });

  // Connection-recovered compensation: agent/session changes that were
  // broadcast while disconnected are not replayed, so re-read the lists.
  // Sessions use "upsert" so a reconnect does not truncate a list the user
  // has paginated deeper into.
  useReconnectedSync(() => {
    if (!projectId || !client) return;
    void refreshProjectAgents(projectId).then(() => {
      void refreshProjectSessions(projectId);
    });
  });
}
