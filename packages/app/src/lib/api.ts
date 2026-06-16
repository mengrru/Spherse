import type {
  AgentProfile,
  SessionInfo,
  ContentResponse,
  FileEntry,
  ScheduleEntry,
  ScheduleInfo,
  ScheduleLogEntry,
  ScheduleServerEvent,
  AgentCreateResponse,
  AgentUpdateResponse,
  AiAccessSettingsResponse,
  WelcomePageSettingsResponse,
} from "./types";
import type {
  ProviderCatalogContract,
  TurnContextSnapshotContract,
  SessionMessagesResponse,
} from "@spherse/server/contracts";
import { parseApiResponse, schemas } from "@spherse/server/contracts";

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(err.error ?? "request failed");
  }
}

async function parseJsonResponse<T>(
  res: Response,
  schema: Parameters<typeof parseApiResponse>[0],
): Promise<T> {
  return parseApiResponse(schema, await res.json()) as T;
}

export function createApiClient(baseUrl: string, projectId: string) {
  const apiBase = `${baseUrl}/api/projects/${projectId}`;
  const wsUrl = baseUrl.replace(/^http/, "ws");
  const wsProjectBase = `${wsUrl}/ws/projects/${projectId}`;

  return {
    baseUrl,
    async listAgents(): Promise<AgentProfile[]> {
      const res = await fetch(`${apiBase}/agents`);
      await assertOk(res);
      return parseJsonResponse<AgentProfile[]>(res, schemas.agentListResponse);
    },

    async getAgent(id: string): Promise<AgentProfile> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}`);
      await assertOk(res);
      return parseJsonResponse<AgentProfile>(res, schemas.agentProfile);
    },

    async createSession(agentId: string): Promise<{ sessionId: string }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions`, {
        method: "POST",
      });
      await assertOk(res);
      return parseJsonResponse<{ sessionId: string }>(res, schemas.sessionCreateResponse);
    },

    async getSession(agentId: string, id: string): Promise<SessionInfo> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`);
      await assertOk(res);
      return parseJsonResponse<SessionInfo>(res, schemas.sessionInfo);
    },

    async listSessions(agentId: string): Promise<SessionInfo[]> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions`);
      await assertOk(res);
      return parseJsonResponse<SessionInfo[]>(res, schemas.sessionListResponse);
    },

    async getSessionMessages(agentId: string, id: string): Promise<SessionMessagesResponse> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}/messages`);
      await assertOk(res);
      return parseJsonResponse<SessionMessagesResponse>(res, schemas.sessionMessagesResponse);
    },

    async listContent(dirPath: string = ""): Promise<FileEntry[]> {
      const res = await fetch(
        `${apiBase}/content/${encodeURIComponent(dirPath)}`,
      );
      if (!res.ok) return [];
      const data = await res.json();
      try {
        return parseApiResponse(schemas.fileEntries, data) as FileEntry[];
      } catch {
        return [];
      }
    },

    async getContent(filePath: string): Promise<ContentResponse | null> {
      const res = await fetch(
        `${apiBase}/content/${encodeURIComponent(filePath)}`,
      );
      if (!res.ok) return null;
      return parseJsonResponse<ContentResponse>(res, schemas.contentResponse);
    },

    async saveContent(filePath: string, content: string): Promise<{ ok: boolean }> {
      const res = await fetch(
        `${apiBase}/content/${encodeURIComponent(filePath)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async deleteContent(filePath: string): Promise<{ ok: boolean }> {
      const res = await fetch(
        `${apiBase}/content/${encodeURIComponent(filePath)}`,
        {
          method: "DELETE",
        },
      );
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async mkdir(dirPath: string): Promise<{ ok: boolean }> {
      const res = await fetch(
        `${apiBase}/content/${encodeURIComponent(dirPath)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mkdir" }),
        },
      );
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async touchFile(filePath: string): Promise<{ ok: boolean }> {
      const res = await fetch(
        `${apiBase}/content/${encodeURIComponent(filePath)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "touch" }),
        },
      );
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async createAgent(slug: string, content: string, themeContent?: string): Promise<AgentCreateResponse> {
      const res = await fetch(`${apiBase}/agents/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, content, themeContent }),
      });
      await assertOk(res);
      return parseJsonResponse<AgentCreateResponse>(res, schemas.agentCreateResponse);
    },

    async getAgentRaw(id: string): Promise<string> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}/raw`);
      await assertOk(res);
      const data = await parseJsonResponse<{ content: string }>(res, schemas.agentRawResponse);
      return data.content;
    },

    async getAgentTheme(id: string): Promise<string> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}/theme`);
      if (!res.ok) return "";
      return res.text();
    },

    async updateAgent(id: string, content: string, themeContent?: string): Promise<AgentUpdateResponse> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, themeContent }),
      });
      await assertOk(res);
      return parseJsonResponse<AgentUpdateResponse>(res, schemas.agentUpdateResponse);
    },

    async deleteAgent(id: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async renameSession(agentId: string, id: string, title: string): Promise<SessionInfo> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await assertOk(res);
      return parseJsonResponse<SessionInfo>(res, schemas.sessionInfo);
    },

    async deleteSession(agentId: string, id: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async getFileTree(): Promise<string[]> {
      const res = await fetch(`${apiBase}/file-tree`);
      if (!res.ok) return [];
      return parseJsonResponse<string[]>(res, schemas.fileTreeResponse);
    },

    async getTurnContext(sessionId: string): Promise<TurnContextSnapshotContract> {
      const res = await fetch(
        `${apiBase}/debug/sessions/${encodeURIComponent(sessionId)}/turn-context`,
      );
      await assertOk(res);
      return parseJsonResponse<TurnContextSnapshotContract>(res, schemas.turnContextSnapshot);
    },

    getPreviewUrl(filePath: string): string {
      return `${apiBase}/preview/${filePath}`;
    },

    async getSupportedProviders(): Promise<ProviderCatalogContract> {
      const res = await fetch(`${baseUrl}/api/settings/providers`);
      await assertOk(res);
      return parseJsonResponse<ProviderCatalogContract>(res, schemas.providerCatalog);
    },

    async getAiAccessSettings(): Promise<AiAccessSettingsResponse> {
      const res = await fetch(`${apiBase}/settings/ai-access`);
      if (!res.ok) return { ok: false, deniedPaths: [] };
      return parseJsonResponse<AiAccessSettingsResponse>(res, schemas.aiAccessSettingsResponse);
    },

    async updateAiAccessSettings(deniedPaths: string[]): Promise<AiAccessSettingsResponse> {
      const res = await fetch(`${apiBase}/settings/ai-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deniedPaths }),
      });
      await assertOk(res);
      return parseJsonResponse<AiAccessSettingsResponse>(res, schemas.aiAccessSettingsResponse);
    },

    async getWelcomePageSettings(): Promise<WelcomePageSettingsResponse> {
      const res = await fetch(`${apiBase}/settings/welcome-page`);
      if (!res.ok) return { ok: false, path: null };
      return parseJsonResponse<WelcomePageSettingsResponse>(res, schemas.welcomePageSettingsResponse);
    },

    async updateWelcomePageSettings(path: string | null): Promise<WelcomePageSettingsResponse> {
      const res = await fetch(`${apiBase}/settings/welcome-page`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      await assertOk(res);
      return parseJsonResponse<WelcomePageSettingsResponse>(res, schemas.welcomePageSettingsResponse);
    },

    async listSchedules(agentId: string): Promise<ScheduleInfo[]> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedules`);
      await assertOk(res);
      return parseJsonResponse<ScheduleInfo[]>(res, schemas.scheduleListResponse);
    },

    async createSchedule(agentId: string, data: {
      name?: string;
      cron: string;
      mode: "new_session" | "existing_session";
      targetSessionId?: string;
      message: string;
      notify: boolean;
      notificationMessage?: string;
    }): Promise<ScheduleEntry> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await assertOk(res);
      return parseJsonResponse<ScheduleEntry>(res, schemas.scheduleEntry);
    },

    async updateSchedule(agentId: string, scheduleId: string, data: {
      name?: string;
      enabled?: boolean;
      cron?: string;
      mode?: "new_session" | "existing_session";
      targetSessionId?: string;
      message?: string;
      notify?: boolean;
      notificationMessage?: string;
    }): Promise<ScheduleEntry> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await assertOk(res);
      return parseJsonResponse<ScheduleEntry>(res, schemas.scheduleEntry);
    },

    async deleteSchedule(agentId: string, scheduleId: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}`, {
        method: "DELETE",
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async triggerSchedule(agentId: string, scheduleId: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}/trigger`, {
        method: "POST",
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async getScheduleLogs(agentId: string, limit?: number): Promise<ScheduleLogEntry[]> {
      const params = limit ? `?limit=${limit}` : "";
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedule-logs${params}`);
      await assertOk(res);
      return parseJsonResponse<ScheduleLogEntry[]>(res, schemas.scheduleLogListResponse);
    },

    createScheduleWebSocket(onEvent: (event: ScheduleServerEvent) => void): WebSocket {
      const url = `${wsProjectBase}/schedule`;
      const ws = new WebSocket(url);
      ws.onmessage = (event) => {
        try { onEvent(JSON.parse(event.data)); } catch { /* ignore parse errors */ }
      };
      ws.onerror = () => {};
      return ws;
    },

    createFsWatchWebSocket(onChange: () => void): WebSocket {
      const url = `${wsProjectBase}/fs-watch`;
      const ws = new WebSocket(url);
      ws.onmessage = () => onChange();
      ws.onerror = () => {};
      return ws;
    },

    createLogWebSocket(onLog: (line: string) => void): WebSocket {
      const url = `${wsUrl}/ws/debug`;
      const ws = new WebSocket(url);
      ws.onmessage = (event) => {
        onLog(event.data);
      };
      ws.onerror = () => {};
      return ws;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
