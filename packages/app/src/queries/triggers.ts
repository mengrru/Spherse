import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";
import type { ProjectTriggerListResponse, TriggerEntry, TriggerInfo } from "../lib/types";

type ProjectTriggers = ProjectTriggerListResponse["triggers"];

export function selectAgentTriggers(triggers: ProjectTriggers | undefined, agentId: string): TriggerInfo[] {
  if (!triggers) return [];
  return triggers.filter((trigger) => trigger.agentId === agentId);
}

export function selectAgentHasEnabledTrigger(
  triggers: ProjectTriggers | undefined,
  agentId: string,
): boolean {
  if (!triggers) return false;
  return triggers.some((trigger) => trigger.agentId === agentId && trigger.enabled);
}

export function projectTriggersQueryOptions(projectId: string, client: ApiClient) {
  return {
    queryKey: projectQueryKeys.triggers(projectId),
    queryFn: () => client.listProjectTriggers(),
    gcTime: Number.POSITIVE_INFINITY,
  };
}

export function useProjectTriggers(projectId: string, client: ApiClient) {
  return useQuery(projectTriggersQueryOptions(projectId, client));
}

export function useAgentTriggers(projectId: string, client: ApiClient, agentId: string) {
  const query = useQuery(projectTriggersQueryOptions(projectId, client));
  return {
    triggers: selectAgentTriggers(query.data?.triggers, agentId),
    isPending: query.isPending,
  };
}

export function useAgentHasEnabledTrigger(projectId: string, client: ApiClient, agentId: string) {
  const query = useQuery(projectTriggersQueryOptions(projectId, client));
  return selectAgentHasEnabledTrigger(query.data?.triggers, agentId);
}

export async function invalidateProjectTriggers(projectId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: projectQueryKeys.triggers(projectId) });
}

export async function createAgentTrigger(
  projectId: string,
  client: ApiClient,
  agentId: string,
  data: Parameters<ApiClient["createTrigger"]>[1],
): Promise<void> {
  await client.createTrigger(agentId, data);
  await invalidateProjectTriggers(projectId);
}

export async function updateAgentTrigger(
  projectId: string,
  client: ApiClient,
  agentId: string,
  triggerId: string,
  data: Parameters<ApiClient["updateTrigger"]>[2],
): Promise<void> {
  await client.updateTrigger(agentId, triggerId, data);
  await invalidateProjectTriggers(projectId);
}

export async function deleteAgentTrigger(
  projectId: string,
  client: ApiClient,
  agentId: string,
  triggerId: string,
): Promise<void> {
  await client.deleteTrigger(agentId, triggerId);
  await invalidateProjectTriggers(projectId);
}

export async function resetAgentTriggerBinding(
  projectId: string,
  client: ApiClient,
  agentId: string,
  triggerId: string,
): Promise<TriggerEntry | null> {
  const result = await client.resetTriggerBinding(agentId, triggerId);
  await invalidateProjectTriggers(projectId);
  return result;
}
