import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "./api";
import { projectQueryKeys, queryClient } from "./query-client";

export function directoryQueryOptions(projectId: string, client: ApiClient, dirPath: string) {
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

export function invalidateProjectFileQueries(projectId: string, changedPath?: string): void {
  if (changedPath) {
    const normalizedPath = changedPath.replace(/\\/g, "/");
    void queryClient.invalidateQueries({
      queryKey: projectQueryKeys.content(projectId, normalizedPath),
    });
  } else {
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "content"],
    });
  }
  void queryClient.invalidateQueries({ queryKey: projectQueryKeys.directories(projectId) });
  void queryClient.invalidateQueries({ queryKey: projectQueryKeys.fileTree(projectId) });
}
