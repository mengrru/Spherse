import { useQuery } from "@tanstack/react-query";
import type { GlobalApiClient } from "../lib/api";
import { queryClient } from "./client";
import { marketplaceQueryKeys } from "./keys";

export function useMarketplaceProjects(client: GlobalApiClient, enabled: boolean) {
  return useQuery({
    queryKey: marketplaceQueryKeys.projects(),
    queryFn: () => client.listMarketplaceProjects(),
    enabled,
    staleTime: 0,
  });
}

export async function invalidateMarketplaceProjectQueries(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: marketplaceQueryKeys.projects() });
}
