import { queryClient } from "../client";
import { projectQueryKeys } from "../keys";

const projectGenerations = new Map<string, number>();

export function getProjectGeneration(projectId: string): number {
  return projectGenerations.get(projectId) ?? 0;
}

export function isCurrentProjectGeneration(projectId: string, generation: number): boolean {
  return getProjectGeneration(projectId) === generation;
}

export function clearProjectQueries(projectId: string): void {
  projectGenerations.set(projectId, getProjectGeneration(projectId) + 1);
  void queryClient.cancelQueries({ queryKey: projectQueryKeys.all(projectId) });
  queryClient.removeQueries({ queryKey: projectQueryKeys.all(projectId) });
}
