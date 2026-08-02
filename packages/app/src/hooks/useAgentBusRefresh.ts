import { useBusSubscription } from "./useBusSubscription";
import { useProjectDataStore } from "../stores/project-data-store";
import type { ApiClient } from "../lib/api";

/**
 * Keeps the cached agent list in sync when agents are created/updated/deleted outside the UI
 * (e.g. by an agent calling the `manage_agent` tool).
 */
export function useAgentBusRefresh(projectId: string | undefined, client: ApiClient | null): void {
  useBusSubscription(projectId ?? "", "agent", (type, payload) => {
    if (type !== "agent_updated" || !projectId || !client) return;
    const store = useProjectDataStore.getState();
    void store.refreshAgents(projectId, client).then(() => {
      const action = (payload as { action?: string }).action;
      if (action === "created" || action === "deleted") {
        void store.refreshSessions(projectId, client);
      }
    });
  });
}
