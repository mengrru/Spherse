import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { ScheduleLogEntry } from "../../../lib/types";
import { LOG_LIMIT } from "../constants";

export function useScheduleLogs(
  client: ApiClient,
  agentId: string,
  active: boolean,
  scheduleEventVersion: number,
): ScheduleLogEntry[] {
  const [logs, setLogs] = useState<ScheduleLogEntry[]>([]);
  useEffect(() => {
    if (!active) return;
    client.getScheduleLogs(agentId, LOG_LIMIT).then(setLogs).catch(() => {});
  }, [client, agentId, active, scheduleEventVersion]);
  return logs;
}
