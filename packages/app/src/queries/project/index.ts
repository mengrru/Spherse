import type { ApiClient } from "../../lib/api";
import { useProjectAgents } from "./agents";
import { useProjectSessions } from "./sessions";

export { clearProjectQueries } from "./lifecycle";
export {
  createProjectAgent,
  deleteProjectAgent,
  ensureProjectAgents,
  getCachedAgents,
  refreshProjectAgents,
  updateProjectAgent,
  useProjectAgents,
} from "./agents";
export {
  createProjectSession,
  deleteProjectSession,
  ensureProjectSession,
  fetchProjectSessionCatalog,
  getCachedSession,
  loadMoreProjectSessions,
  refreshProjectSessions,
  renameProjectSession,
  useProjectSession,
} from "./sessions";

export function useProjectCatalog(projectId: string, client: ApiClient | null) {
  const agentsQuery = useProjectAgents(projectId, client);
  const sessionsQuery = useProjectSessions(projectId, client);
  return {
    agents: agentsQuery.agents,
    sessions: sessionsQuery.sessions,
    sessionPaging: sessionsQuery.sessionPaging,
    loading: agentsQuery.loading || sessionsQuery.loading,
    error: agentsQuery.error ?? sessionsQuery.error,
  };
}
