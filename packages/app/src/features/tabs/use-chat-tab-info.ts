import { useApiClient } from "../../lib/use-connection";
import { sessionDisplayTitle } from "../../lib/session-title";
import { useProjectCatalog, useProjectSession } from "../../queries/project";

export interface ChatTabInfo {
  title: string | null;
  agentName: string | null;
  gone: boolean;
}

export function useChatTabInfo(projectId: string, sessionId: string): ChatTabInfo {
  const client = useApiClient(projectId);
  const { agents, sessions, loading, error } = useProjectCatalog(projectId, client);
  const fromCatalog = sessions.find((s) => s.id === sessionId);
  const catalogReady = !loading && !error;
  const query = useProjectSession(projectId, client, catalogReady && !fromCatalog ? sessionId : null);
  const session = fromCatalog ?? query.data ?? null;
  const agent = session ? agents.find((a) => a.id === session.agentId) ?? null : null;
  const missing = catalogReady && !fromCatalog && query.isSuccess && query.data === null;
  const orphaned = catalogReady && session !== null && agent === null;

  return {
    title: session ? sessionDisplayTitle(session) : null,
    agentName: agent?.name ?? null,
    gone: missing || orphaned,
  };
}
