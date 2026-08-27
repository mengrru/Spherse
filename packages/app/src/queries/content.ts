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

export function useProjectDirectory(
  projectId: string,
  client: ApiClient,
  dirPath: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...directoryQueryOptions(projectId, client, dirPath),
    enabled: options?.enabled,
  });
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

function parentDirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function directoryKeyMatchesChangedPath(
  queryKey: readonly unknown[],
  projectId: string,
  changedPath: string,
): boolean {
  if (queryKey[0] !== "projects" || queryKey[1] !== projectId || queryKey[2] !== "directories") {
    return false;
  }
  const dirPath = queryKey[3];
  if (typeof dirPath !== "string") return false;
  if (dirPath === changedPath || dirPath.startsWith(`${changedPath}/`)) return true;
  return dirPath === parentDirOf(changedPath);
}

export async function invalidateProjectFileQueries(projectId: string, changedPath?: string): Promise<void> {
  const invalidations: Promise<void>[] = [];
  if (changedPath) {
    const normalizedPath = changedPath.replace(/\\/g, "/");
    invalidations.push(
      queryClient.invalidateQueries({
        predicate: (query) =>
          contentKeyMatchesChangedPath(query.queryKey, projectId, normalizedPath) ||
          directoryKeyMatchesChangedPath(query.queryKey, projectId, normalizedPath),
      }),
    );
  } else {
    invalidations.push(queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "content"],
    }), queryClient.invalidateQueries({
      queryKey: projectQueryKeys.directories(projectId),
    }));
  }
  invalidations.push(
    queryClient.invalidateQueries({ queryKey: projectQueryKeys.fileTree(projectId) }),
  );
  await Promise.all(invalidations);
}
