import { useMemo } from "react";
import type { SessionInfo } from "../../../lib/types";

export function useGroupedSessions(sessions: SessionInfo[]) {
  return useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const session of sessions) {
      const list = map.get(session.agentId) ?? [];
      list.push(session);
      map.set(session.agentId, list);
    }
    return map;
  }, [sessions]);
}
