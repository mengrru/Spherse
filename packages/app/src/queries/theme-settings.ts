import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";

export const THEME_SETTINGS_CSS_PATH = ".spherse/theme.css";

export function themeSettingsQueryOptions(projectId: string, client: ApiClient, enabled: boolean) {
  return {
    queryKey: projectQueryKeys.themeSettings(projectId),
    queryFn: () => client.getThemeSettings(),
    enabled,
    gcTime: Number.POSITIVE_INFINITY,
  };
}

export function useThemeSettings(projectId: string, client: ApiClient, enabled: boolean) {
  return useQuery(themeSettingsQueryOptions(projectId, client, enabled));
}

export async function invalidateThemeSettings(projectId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: projectQueryKeys.themeSettings(projectId) });
}

export async function updateProjectThemeSettings(
  projectId: string,
  client: ApiClient,
  content: string,
): Promise<void> {
  await client.updateThemeSettings(content);
  await invalidateThemeSettings(projectId);
}
