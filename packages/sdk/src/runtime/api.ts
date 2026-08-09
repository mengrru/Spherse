import { call } from "./messaging.js";

type Params = Record<string, unknown>;

/**
 * Read-only bridge to the server HTTP API. All traffic funnels through the single
 * `api.call` action, which the host maps onto an allowlist of `op` values — there is no
 * way for injected HTML to reach arbitrary endpoints or mutate state.
 */
function apiCall(op: string, args: Params = {}): Promise<unknown> {
  return call("api.call", { op, args });
}

export const api = {
  call: apiCall,
  agents: {
    list: (): Promise<unknown> => apiCall("agents.list"),
    get: (id: string): Promise<unknown> => apiCall("agents.get", { id }),
  },
  sessions: {
    list: (agentId: string): Promise<unknown> => apiCall("sessions.list", { agentId }),
    messages: (agentId: string, id: string): Promise<unknown> =>
      apiCall("sessions.messages", { agentId, id }),
    status: (agentId: string, id: string): Promise<unknown> =>
      apiCall("sessions.status", { agentId, id }),
  },
  content: {
    get: (filePath: string): Promise<unknown> => apiCall("content.get", { path: filePath }),
    listDir: (dirPath: string): Promise<unknown> => apiCall("content.listDir", { path: dirPath }),
    stat: (filePath: string): Promise<unknown> => apiCall("content.stat", { path: filePath }),
  },
  fileTree: (): Promise<unknown> => apiCall("fileTree"),
};
