import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";

export function useProjectSkills(projectId: string, client: ApiClient) {
  return useQuery({
    queryKey: projectQueryKeys.skills(projectId),
    queryFn: () => client.listSkills(),
  });
}

export function marketplaceSkillsQueryOptions(projectId: string, client: ApiClient, enabled: boolean) {
  return {
    queryKey: projectQueryKeys.marketplaceSkills(projectId),
    queryFn: () => client.listMarketplaceSkills(),
    enabled,
    staleTime: 0,
  };
}

export function useMarketplaceSkills(projectId: string, client: ApiClient, enabled: boolean) {
  return useQuery(marketplaceSkillsQueryOptions(projectId, client, enabled));
}

export async function invalidateProjectSkillQueries(projectId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: projectQueryKeys.skills(projectId) });
}

export async function invalidateMarketplaceQueries(projectId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: projectQueryKeys.marketplaceSkills(projectId) });
}
