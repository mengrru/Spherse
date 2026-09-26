import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";

export type CustomSidePanelResolution = { path: string | null };

export const PROJECT_CONFIG_PATH = ".spherse/project.yaml";

async function resolveCustomSidePanel(client: ApiClient): Promise<CustomSidePanelResolution> {
  const settings = await client.getSidePanelSettings();
  if (!settings.path) return { path: null };
  const res = await fetch(client.getPreviewUrl(settings.path));
  return { path: res.ok ? settings.path : null };
}

export function customSidePanelQueryOptions(projectId: string, client: ApiClient, enabled = true) {
  return {
    queryKey: projectQueryKeys.customSidePanel(projectId),
    queryFn: () => resolveCustomSidePanel(client),
    gcTime: Number.POSITIVE_INFINITY,
    enabled,
  };
}

export function useCustomSidePanel(projectId: string | null, client: ApiClient | null) {
  return useQuery(customSidePanelQueryOptions(projectId ?? "", client as ApiClient, projectId != null && client != null));
}

export async function invalidateCustomSidePanel(projectId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: projectQueryKeys.customSidePanel(projectId) });
}

export async function updateCustomSidePanelSettings(
  projectId: string,
  client: ApiClient,
  path: string | null,
): Promise<{ path: string | null }> {
  const result = await client.updateSidePanelSettings(path);
  await invalidateCustomSidePanel(projectId);
  return result;
}
