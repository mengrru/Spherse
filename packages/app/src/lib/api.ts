import type {
  AgentProfile,
  SessionInfo,
  ContentResponse,
  FileEntry,
  ChatMessage,
  ScheduleEntry,
  ScheduleInfo,
  ScheduleLogEntry,
  ScheduleServerEvent,
} from "./types";
import { parseApiResponse, schemas } from "@spherse/server/contracts";

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
      return res.json();
    },

    async getAgent(id: string): Promise<AgentProfile> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}`);
      return res.json();
    },

    async createSession(agentId: string): Promise<{ sessionId: string }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return parseJsonResponse(res, schemas.createSessionResponse);
    },

    async getSession(agentId: string, id: string): Promise<SessionInfo> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`);
      return res.json();
    },

    async listSessions(agentId: string): Promise<SessionInfo[]> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions`);
      return res.json();
    },

    async getSessionMessages(agentId: string, id: string): Promise<ChatMessage[]> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}/messages`);
      return res.json();
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
      return parseJsonResponse(res, schemas.contentResponse);
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return parseJsonResponse(res, schemas.okResponse);
    },

    async deleteContent(filePath: string): Promise<{ ok: boolean }> {
      const res = await fetch(
        `${apiBase}/content/${encodeURIComponent(filePath)}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return parseJsonResponse(res, schemas.okResponse);
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return parseJsonResponse(res, schemas.okResponse);
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return parseJsonResponse(res, schemas.okResponse);
    },

    async createAgent(slug: string, content: string, themeContent?: string): Promise<{ ok: boolean; id: string }> {
      const res = await fetch(`${apiBase}/agents/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, content, themeContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async getAgentRaw(id: string): Promise<string> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}/raw`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      const data = await res.json();
      return data.content;
    },

    async getAgentTheme(id: string): Promise<string> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}/theme`);
      if (!res.ok) return "";
      return res.text();
    },

    async updateAgent(id: string, content: string, themeContent?: string): Promise<{ ok: boolean; id: string }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, themeContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async deleteAgent(id: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return parseJsonResponse(res, schemas.okResponse);
    },

    async renameSession(agentId: string, id: string, title: string): Promise<SessionInfo> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return parseJsonResponse(res, schemas.sessionInfo);
    },

    async deleteSession(agentId: string, id: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return parseJsonResponse(res, schemas.okResponse);
    },

    async getFileTree(): Promise<string[]> {
      const res = await fetch(`${apiBase}/file-tree`);
      if (!res.ok) return [];
      return parseJsonResponse(res, schemas.fileTreeResponse);
    },

    async getTurnContext(sessionId: string): Promise<any> {
      const res = await fetch(
        `${apiBase}/debug/sessions/${encodeURIComponent(sessionId)}/turn-context`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    getPreviewUrl(filePath: string): string {
      return `${apiBase}/preview/${filePath}`;
    },

    async getSupportedProviders(): Promise<Record<string, import("@spherse/core").ProviderCatalogItem>> {
      const res = await fetch(`${baseUrl}/api/settings/providers`);
      return res.json();
    },

    async getAiAccessSettings(): Promise<{ deniedPaths: string[] }> {
      const res = await fetch(`${apiBase}/settings/ai-access`);
      if (!res.ok) return { deniedPaths: [] };
      return res.json();
    },

    async updateAiAccessSettings(deniedPaths: string[]): Promise<{ ok: boolean; deniedPaths: string[] }> {
      const res = await fetch(`${apiBase}/settings/ai-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deniedPaths }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async getWelcomePageSettings(): Promise<{ path: string | null }> {
      const res = await fetch(`${apiBase}/settings/welcome-page`);
      if (!res.ok) return { path: null };
      return res.json();
    },

    async updateWelcomePageSettings(path: string | null): Promise<{ ok: boolean; path: string | null }> {
      const res = await fetch(`${apiBase}/settings/welcome-page`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async listSchedules(agentId: string): Promise<ScheduleInfo[]> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedules`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "request failed");
      return res.json();
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async deleteSchedule(agentId: string, scheduleId: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async triggerSchedule(agentId: string, scheduleId: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}/trigger`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async getScheduleLogs(agentId: string, limit?: number): Promise<ScheduleLogEntry[]> {
      const params = limit ? `?limit=${limit}` : "";
      const res = await fetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/schedule-logs${params}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "request failed");
      return res.json();
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
