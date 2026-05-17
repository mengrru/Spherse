import type {
  AgentProfile,
  SessionInfo,
  ContentResponse,
  FileEntry,
  ChatMessage,
  AgentEvent,
} from "./types";

export function createApiClient(port: number) {
  const baseUrl = `http://localhost:${port}`;
  const wsUrl = `ws://localhost:${port}`;

  return {
    async listAgents(): Promise<AgentProfile[]> {
      const res = await fetch(`${baseUrl}/api/agents`);
      return res.json();
    },

    async getAgent(id: string): Promise<AgentProfile> {
      const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(id)}`);
      return res.json();
    },

    async createSession(agentId: string): Promise<{ sessionId: string }> {
      const res = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      return res.json();
    },

    async getSession(id: string): Promise<SessionInfo> {
      const res = await fetch(`${baseUrl}/api/sessions/${id}`);
      return res.json();
    },

    async listSessions(agentId?: string): Promise<SessionInfo[]> {
      const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
      const res = await fetch(`${baseUrl}/api/sessions${query}`);
      return res.json();
    },

    async getSessionMessages(id: string): Promise<ChatMessage[]> {
      const res = await fetch(`${baseUrl}/api/sessions/${id}/messages`);
      return res.json();
    },

    async listContent(dirPath: string = ""): Promise<FileEntry[]> {
      const res = await fetch(
        `${baseUrl}/api/content/${encodeURIComponent(dirPath)}`,
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },

    async getContent(filePath: string): Promise<ContentResponse | null> {
      const res = await fetch(
        `${baseUrl}/api/content/${encodeURIComponent(filePath)}`,
      );
      if (!res.ok) return null;
      return res.json();
    },

    async saveContent(filePath: string, content: string): Promise<{ ok: boolean }> {
      const res = await fetch(
        `${baseUrl}/api/content/${encodeURIComponent(filePath)}`,
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
      return res.json();
    },

    async createAgent(filename: string, content: string): Promise<{ ok: boolean; id: string }> {
      const res = await fetch(`${baseUrl}/api/agents/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async getAgentRaw(id: string): Promise<string> {
      const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(id)}/raw`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      const data = await res.json();
      return data.content;
    },

    async updateAgent(id: string, content: string): Promise<{ ok: boolean; id: string }> {
      const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async deleteAgent(id: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async deleteSession(id: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },

    async getFileTree(): Promise<string[]> {
      const res = await fetch(`${baseUrl}/api/file-tree`);
      if (!res.ok) return [];
      return res.json();
    },

    getPreviewUrl(filePath: string): string {
      return `${baseUrl}/api/preview/${filePath}`;
    },

    async getSupportedProviders(): Promise<Record<string, {
      name: string;
      envKey: string;
      models: readonly string[];
    }>> {
      const res = await fetch(`${baseUrl}/api/settings/providers`);
      return res.json();
    },

    createChatWebSocket(
      sessionId: string,
      onEvent: (event: AgentEvent) => void,
    ): WebSocket {
      const url = `${wsUrl}/ws/chat/${sessionId}`;
      console.log("[WS] connecting to", url);
      const ws = new WebSocket(url);
      ws.onopen = () => console.log("[WS] connected");
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        onEvent(data);
      };
      ws.onerror = (e) => {
        console.error("[WS] error", e);
        onEvent({ type: "error", message: "WebSocket connection error" });
      };
      return ws;
    },

    createFsWatchWebSocket(onChange: () => void): WebSocket {
      const url = `${wsUrl}/ws/fs-watch`;
      const ws = new WebSocket(url);
      ws.onmessage = () => onChange();
      ws.onerror = () => {};
      return ws;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
