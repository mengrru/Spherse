import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";

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

export function contentKeyMatchesChangedPath(
  queryKey: readonly unknown[],
  projectId: string,
  changedPath: string,
): boolean {
  if (queryKey[0] !== "projects" || queryKey[1] !== projectId || queryKey[2] !== "content") {
    return false;
  }
  const filePath = queryKey[3];
  if (typeof filePath !== "string") return false;
  return filePath === changedPath || filePath.startsWith(`${changedPath}/`);
}

export async function invalidateProjectFileQueries(projectId: string, changedPath?: string): Promise<void> {
  const invalidations: Promise<void>[] = [];
  if (changedPath) {
    const normalizedPath = changedPath.replace(/\\/g, "/");
    invalidations.push(
      queryClient.invalidateQueries({
        predicate: (query) => contentKeyMatchesChangedPath(query.queryKey, projectId, normalizedPath),
      }),
    );
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
