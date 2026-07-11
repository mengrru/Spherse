import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { TriggerLogEntry } from "../../../lib/types";
import { LOG_LIMIT } from "../constants";

export function useTriggerLogs(
  client: ApiClient,
  agentId: string,
  active: boolean,
  triggerEventVersion: number,
): TriggerLogEntry[] {
  const [logs, setLogs] = useState<TriggerLogEntry[]>([]);
  useEffect(() => {
    if (!active) return;
    client.getTriggerLogs(agentId, LOG_LIMIT).then(setLogs).catch(() => {});
  }, [client, agentId, active, triggerEventVersion]);
  return logs;
}
