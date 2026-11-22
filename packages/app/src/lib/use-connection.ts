/* eslint-disable no-redeclare */
import { useMemo } from "react";
import { useAppStore } from "../stores/app-store";
import { createApiClient, createGlobalApiClient, type ApiClient, type GlobalApiClient } from "./api";
import { isRpcClientEnabled } from "./rpc/enabled";
import { createRpcApiClient, createRpcGlobalApiClient } from "./rpc/api-adapter";
import { getSharedRpcClient } from "./rpc/shared";

const rpcAccessToken = () => useAppStore.getState().connection.accessToken;

export function useApiClient(projectId: string): ApiClient;
export function useApiClient(projectId: string | null | undefined): ApiClient | null;
export function useApiClient(projectId: string | null | undefined): ApiClient | null {
  const baseUrl = useAppStore((s) => s.connection.baseUrl);
  const accessToken = useAppStore((s) => s.connection.accessToken);
  return useMemo(
    () =>
      projectId
        ? isRpcClientEnabled()
          ? createRpcApiClient(baseUrl, projectId, accessToken, getSharedRpcClient(baseUrl, rpcAccessToken))
          : createApiClient(baseUrl, projectId, accessToken)
        : null,
    [baseUrl, accessToken, projectId],
  );
}

export function useGlobalApiClient(): GlobalApiClient | null {
  const baseUrl = useAppStore((s) => s.connection.baseUrl);
  const accessToken = useAppStore((s) => s.connection.accessToken);
  return useMemo(
    () =>
      baseUrl
        ? isRpcClientEnabled()
          ? createRpcGlobalApiClient(baseUrl, accessToken, getSharedRpcClient(baseUrl, rpcAccessToken))
          : createGlobalApiClient(baseUrl, accessToken)
        : null,
    [baseUrl, accessToken],
  );
}

export function useConnection() {
  return useAppStore((s) => s.connection);
}

