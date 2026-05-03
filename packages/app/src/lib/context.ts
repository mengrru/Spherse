import { createApiClient } from "./api";
import type { ApiClient } from "./api";

export interface AppContext {
  client: ApiClient;
  port: number;
  projectRoot: string;
}

export function initAppContext(port: number, projectRoot: string): AppContext {
  return {
    client: createApiClient(port),
    port,
    projectRoot,
  };
}
