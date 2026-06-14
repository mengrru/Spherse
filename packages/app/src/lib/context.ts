import { createApiClient } from "./api";
import type { ApiClient } from "./api";

export interface AppContext {
  client: ApiClient;
  baseUrl: string;
  projectId: string;
  projectRoot: string;
}

export function initAppContext(baseUrl: string, projectId: string, projectRoot: string): AppContext {
  return {
    client: createApiClient(baseUrl, projectId),
    baseUrl,
    projectId,
    projectRoot,
  };
}
