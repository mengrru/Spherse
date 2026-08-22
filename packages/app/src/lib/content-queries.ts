import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "./api";
import { projectQueryKeys, queryClient } from "./query-client";

function directoryQueryOptions(projectId: string, client: ApiClient, dirPath: string) {
  return {
    queryKey: projectQueryKeys.directory(projectId, dirPath),
    queryFn: () => client.listContent(dirPath),
  };
}

export function useProjectDirectory(projectId: string, client: ApiClient, dirPath: string) {
  return useQuery(directoryQueryOptions(projectId, client, dirPath));
}

export function fetchProjectDirectory(projectId: string, client: ApiClient, dirPath: string) {
  return queryClient.fetchQuery(directoryQueryOptions(projectId, client, dirPath));
}

export function useProjectFileTree(projectId: string, client: ApiClient) {
  return useQuery({
    queryKey: projectQueryKeys.fileTree(projectId),
    queryFn: () => client.getFileTree(),
  });
}

export async function invalidateProjectFileQueries(projectId: string, changedPath?: string): Promise<void> {
  const invalidations: Promise<void>[] = [];
  if (changedPath) {
    const normalizedPath = changedPath.replace(/\\/g, "/");
    invalidations.push(queryClient.invalidateQueries({
      queryKey: projectQueryKeys.content(projectId, normalizedPath),
    }));
  } else {
    invalidations.push(queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "content"],
    }));
  }
  invalidations.push(
    queryClient.invalidateQueries({ queryKey: projectQueryKeys.directories(projectId) }),
    queryClient.invalidateQueries({ queryKey: projectQueryKeys.fileTree(projectId) }),
  );
  await Promise.all(invalidations);
}
