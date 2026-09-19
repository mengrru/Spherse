/* eslint-disable no-redeclare */
import { useMemo } from "react";
import { useAppStore } from "../stores/app-store";
import { createApiClient, createGlobalApiClient, type ApiClient, type GlobalApiClient } from "./api";

export function useApiClient(projectId: string): ApiClient;
export function useApiClient(projectId: string | null | undefined): ApiClient | null;
export function useApiClient(projectId: string | null | undefined): ApiClient | null {
  const baseUrl = useAppStore((s) => s.connection.baseUrl);
  const accessToken = useAppStore((s) => s.connection.accessToken);
  return useMemo(
    () => (projectId ? createApiClient(baseUrl, projectId, accessToken) : null),
    [baseUrl, accessToken, projectId],
  );
}

export function useGlobalApiClient(): GlobalApiClient | null {
  const baseUrl = useAppStore((s) => s.connection.baseUrl);
  const accessToken = useAppStore((s) => s.connection.accessToken);
  return useMemo(
    () => (baseUrl ? createGlobalApiClient(baseUrl, accessToken) : null),
    [baseUrl, accessToken],
  );
}

export function useConnection() {
  return useAppStore((s) => s.connection);
}

