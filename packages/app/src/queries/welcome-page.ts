import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";

export type WelcomePageResolution = { path: string | null };

async function resolveWelcomePage(client: ApiClient): Promise<WelcomePageResolution> {
  const settings = await client.getWelcomePageSettings();
  if (!settings.path) {
    const fallbackRes = await fetch(client.getPreviewUrl("index.html"));
    return { path: fallbackRes.ok ? "index.html" : null };
  }

  const res = await fetch(client.getPreviewUrl(settings.path));
  return { path: res.ok ? settings.path : null };
}

export function welcomePageQueryOptions(projectId: string, client: ApiClient) {
  return {
    queryKey: projectQueryKeys.welcomePage(projectId),
    queryFn: () => resolveWelcomePage(client),
    // 全局默认 gcTime 5 分钟会在组件卸载（离开欢迎页路由）后回收缓存，
    // 导致回页重拉 settings；该查询失效仅由设置保存/重连补偿/项目关闭触发，
    // 与 staleTime: Infinity 配合需显式关闭 GC
    gcTime: Number.POSITIVE_INFINITY,
  };
}

export function useWelcomePage(projectId: string, client: ApiClient) {
  return useQuery(welcomePageQueryOptions(projectId, client));
}

export async function invalidateWelcomePage(projectId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: projectQueryKeys.welcomePage(projectId) });
}

export async function updateWelcomePageSettings(
  projectId: string,
  client: ApiClient,
  path: string | null,
): Promise<{ path: string | null }> {
  const result = await client.updateWelcomePageSettings(path);
  await invalidateWelcomePage(projectId);
  return result;
}
