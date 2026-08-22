import type {
  AgentProfile,
  SessionInfo,
  ContentResponse,
  FileEntry,
  StatResponse,
  TriggerEntry,
  TriggerInfo,
  TriggerLogEntry,
  SkillDefinition,
  AgentCreateResponse,
  AgentUpdateResponse,
  AiAccessSettingsResponse,
  WelcomePageSettingsResponse,
  ThemeSettingsResponse,
  AgentMcpConfig,
  McpServerConfig,
} from "./types";
import type {
  ProviderCatalogContract,
  TurnContextSnapshotContract,
  SessionMessagesResponse,
  SessionMessagesPageResponse,
  SessionListPageResponse,
  SessionStatusResponse,
  DataReadResponseContract as DataReadResponse,
} from "@spherse/server/contracts";
import { parseApiResponse, schemas } from "@spherse/server/contracts";
import { Type } from "@sinclair/typebox";

const attachmentUploadResponse = Type.Object({
  type: Type.Literal("image"),
  path: Type.String(),
  width: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  bytes: Type.Integer(),
});

export interface AttachmentUploadResponse {
  type: "image";
  path: string;
  width?: number;
  height?: number;
  bytes: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new ApiError(err.error ?? "request failed", res.status);
  }
}

async function parseJsonResponse<T>(
  res: Response,
  schema: Parameters<typeof parseApiResponse>[0],
): Promise<T> {
  return parseApiResponse(schema, await res.json()) as T;
}

export function createApiClient(baseUrl: string, projectId: string, accessToken?: string | null) {
  const apiBase = `${baseUrl}/api/projects/${projectId}`;
  const authHeaders: Record<string, string> | undefined = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : undefined;

  function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (!authHeaders) return fetch(url, init);
    const userHeaders = init.headers as Record<string, string> | undefined;
    return fetch(url, {
      ...init,
      headers: userHeaders ? { ...authHeaders, ...userHeaders } : authHeaders,
    });
  }

  return {
    baseUrl,
    accessToken: accessToken ?? null,
    async listAgents(): Promise<AgentProfile[]> {
      const res = await authedFetch(`${apiBase}/agents`);
      await assertOk(res);
      return parseJsonResponse<AgentProfile[]>(res, schemas.agentListResponse);
    },

    async getAgent(id: string): Promise<AgentProfile> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(id)}`);
      await assertOk(res);
      return parseJsonResponse<AgentProfile>(res, schemas.agentProfile);
    },

    async createSession(agentId: string, title?: string): Promise<{ sessionId: string }> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions`, {
        method: "POST",
        ...(title !== undefined
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }
          : {}),
      });
      await assertOk(res);
      return parseJsonResponse<{ sessionId: string }>(res, schemas.sessionCreateResponse);
    },

    async sendMessage(agentId: string, id: string, content: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(
        `${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "request failed" }));
        throw new ApiError(body.error ?? "request failed", res.status);
      }
      return parseJsonResponse<{ ok: boolean }>(res, schemas.sendMessageOkResponse);
    },

    async getSession(agentId: string, id: string): Promise<SessionInfo> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`);
      await assertOk(res);
      return parseJsonResponse<SessionInfo>(res, schemas.sessionInfo);
    },

    async listSessions(agentId: string): Promise<SessionInfo[]> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions`);
      await assertOk(res);
      return parseJsonResponse<SessionInfo[]>(res, schemas.sessionListResponse);
    },

    async listSessionsPage(agentId: string, opts?: { limit?: number; offset?: number }): Promise<SessionListPageResponse> {
      const params = new URLSearchParams();
      if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
      if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
      const query = params.toString();
      const url = `${apiBase}/agents/${encodeURIComponent(agentId)}/sessions${query ? `?${query}` : ""}`;
      const res = await authedFetch(url);
      await assertOk(res);
      return parseJsonResponse<SessionListPageResponse>(res, schemas.sessionListPageResponse);
    },

    async getSessionMessages(agentId: string, id: string): Promise<SessionMessagesResponse> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}/messages`);
      await assertOk(res);
      return parseJsonResponse<SessionMessagesResponse>(res, schemas.sessionMessagesResponse);
    },

    async getSessionMessagesPage(agentId: string, id: string, opts?: { turns?: number; before?: number }): Promise<SessionMessagesPageResponse> {
      const params = new URLSearchParams();
      if (opts?.turns !== undefined) params.set("turns", String(opts.turns));
      if (opts?.before !== undefined) params.set("before", String(opts.before));
      const query = params.toString();
      const url = `${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}/messages${query ? `?${query}` : ""}`;
      const res = await authedFetch(url);
      await assertOk(res);
      return parseJsonResponse<SessionMessagesPageResponse>(res, schemas.sessionMessagesPageResponse);
    },

    async listContent(dirPath: string = ""): Promise<FileEntry[]> {
      const res = await authedFetch(`${apiBase}/content/${encodeURIComponent(dirPath)}`);
      if (!res.ok) return [];
      const data = await res.json();
      try {
        return parseApiResponse(schemas.fileEntries, data) as FileEntry[];
      } catch {
        return [];
      }
    },

    async stat(filePath: string): Promise<StatResponse> {
      const res = await authedFetch(`${apiBase}/stat/${encodeURIComponent(filePath)}`);
      await assertOk(res);
      return parseJsonResponse<StatResponse>(res, schemas.statResponse);
    },

    async dataRead(params: {
      file: string;
      key?: string;
      path?: string;
      offset?: number;
      limit?: number;
      ifVersion?: string;
    }): Promise<DataReadResponse> {
      const res = await authedFetch(`${apiBase}/data/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      await assertOk(res);
      return parseJsonResponse<DataReadResponse>(res, schemas.dataReadResponse);
    },

    async dataMutate(params: {
      file: string;
      name: string;
      args?: Record<string, unknown>;
      idempotencyKey?: string;
    }): Promise<{ version: string; result: unknown }> {
      const res = await authedFetch(`${apiBase}/data/mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      await assertOk(res);
      return parseJsonResponse<{ version: string; result: unknown }>(res, schemas.dataMutateResponse);
    },

    async dataRawSet(params: { file: string; key: string; value: unknown; ifVersion?: string }): Promise<{ version: string }> {
      const res = await authedFetch(`${apiBase}/data/raw-set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      await assertOk(res);
      return parseJsonResponse<{ version: string }>(res, schemas.dataWriteResponse);
    },

    async dataRawDelete(params: { file: string; key: string; ifVersion?: string }): Promise<{ version: string }> {
      const res = await authedFetch(`${apiBase}/data/raw-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      await assertOk(res);
      return parseJsonResponse<{ version: string }>(res, schemas.dataWriteResponse);
    },

    async getContent(filePath: string): Promise<ContentResponse | null> {
      const res = await authedFetch(`${apiBase}/content/${encodeURIComponent(filePath)}`);
      if (!res.ok) return null;
      return parseJsonResponse<ContentResponse>(res, schemas.contentResponse);
    },

    async saveContent(filePath: string, content: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/content/${encodeURIComponent(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async deleteContent(filePath: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/content/${encodeURIComponent(filePath)}`, {
        method: "DELETE",
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async mkdir(dirPath: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/content/${encodeURIComponent(dirPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mkdir" }),
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async touchFile(filePath: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/content/${encodeURIComponent(filePath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "touch" }),
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async createAgent(slugBase: string, content: string, themeContent?: string): Promise<AgentCreateResponse> {
      const res = await authedFetch(`${apiBase}/agents/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugBase, content, themeContent }),
      });
      await assertOk(res);
      return parseJsonResponse<AgentCreateResponse>(res, schemas.agentCreateResponse);
    },

    async createSkill(name: string, description: string, instructions: string): Promise<SkillDefinition> {
      const res = await authedFetch(`${apiBase}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, instructions }),
      });
      await assertOk(res);
      return parseJsonResponse<SkillDefinition>(res, schemas.skillDefinition);
    },

    async installSkill(zipPath: string): Promise<SkillDefinition> {
      const res = await authedFetch(`${apiBase}/skills/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zipPath }),
      });
      await assertOk(res);
      return parseJsonResponse<SkillDefinition>(res, schemas.skillDefinition);
    },

    async getAgentRaw(id: string): Promise<string> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(id)}/raw`);
      await assertOk(res);
      const data = await parseJsonResponse<{ content: string }>(res, schemas.agentRawResponse);
      return data.content;
    },

    async getAgentTheme(id: string): Promise<string> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(id)}/theme`);
      if (!res.ok) return "";
      return res.text();
    },

    async updateAgent(id: string, content: string, themeContent?: string): Promise<AgentUpdateResponse> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, themeContent }),
      });
      await assertOk(res);
      return parseJsonResponse<AgentUpdateResponse>(res, schemas.agentUpdateResponse);
    },

    async getAgentMcp(id: string): Promise<AgentMcpConfig> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(id)}/mcp`);
      if (!res.ok) return { servers: [] };
      return parseJsonResponse<AgentMcpConfig>(res, schemas.agentMcpResponse);
    },

    async updateAgentMcp(id: string, config: { servers: McpServerConfig[] }): Promise<AgentMcpConfig> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(id)}/mcp`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      await assertOk(res);
      return parseJsonResponse<AgentMcpConfig>(res, schemas.agentMcpResponse);
    },

    async deleteAgent(id: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async renameSession(agentId: string, id: string, title: string): Promise<SessionInfo> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await assertOk(res);
      return parseJsonResponse<SessionInfo>(res, schemas.sessionInfo);
    },

    async deleteSession(agentId: string, id: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async getSessionStatus(agentId: string, id: string): Promise<SessionStatusResponse> {
      const res = await authedFetch(
        `${apiBase}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(id)}/status`,
      );
      await assertOk(res);
      return parseJsonResponse<SessionStatusResponse>(res, schemas.sessionStatus);
    },

    async getFileTree(): Promise<string[]> {
      const res = await authedFetch(`${apiBase}/file-tree`);
      if (!res.ok) return [];
      return parseJsonResponse<string[]>(res, schemas.fileTreeResponse);
    },

    async getTurnContext(sessionId: string): Promise<TurnContextSnapshotContract> {
      const res = await authedFetch(
        `${apiBase}/debug/sessions/${encodeURIComponent(sessionId)}/turn-context`,
      );
      await assertOk(res);
      return parseJsonResponse<TurnContextSnapshotContract>(res, schemas.turnContextSnapshot);
    },

    getPreviewUrl(filePath: string, version?: number): string {
      const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
      const pathMiddle = accessToken ? `/preview/__auth/${encodeURIComponent(accessToken)}/${encodedPath}` : `/preview/${encodedPath}`;
      const base = `${apiBase}${pathMiddle}`;
      return version !== undefined ? `${base}?v=${version}` : base;
    },

    async getSupportedProviders(): Promise<ProviderCatalogContract> {
      const res = await authedFetch(`${baseUrl}/api/settings/providers`);
      await assertOk(res);
      return parseJsonResponse<ProviderCatalogContract>(res, schemas.providerCatalog);
    },

    async getImageProviders(): Promise<ProviderCatalogContract> {
      const res = await authedFetch(`${baseUrl}/api/settings/image-providers`);
      await assertOk(res);
      return parseJsonResponse<ProviderCatalogContract>(res, schemas.providerCatalog);
    },

    async exportImage(srcRel: string, destAbs: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/images/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: srcRel, dest: destAbs }),
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async uploadAttachedImage(
      blob: Blob,
      meta?: { width?: number; height?: number },
    ): Promise<AttachmentUploadResponse> {
      const form = new FormData();
      form.append("file", blob);
      if (meta?.width !== undefined) form.append("width", String(meta.width));
      if (meta?.height !== undefined) form.append("height", String(meta.height));
      const res = await authedFetch(`${apiBase}/attachments`, {
        method: "POST",
        body: form,
      });
      await assertOk(res);
      return parseJsonResponse<AttachmentUploadResponse>(res, attachmentUploadResponse);
    },

    async deleteAttachment(path: string): Promise<void> {
      const res = await authedFetch(`${apiBase}/attachments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      await assertOk(res);
    },

    async getAiAccessSettings(): Promise<AiAccessSettingsResponse> {
      const res = await authedFetch(`${apiBase}/settings/ai-access`);
      if (!res.ok) return { ok: false, deniedPaths: [] };
      return parseJsonResponse<AiAccessSettingsResponse>(res, schemas.aiAccessSettingsResponse);
    },

    async updateAiAccessSettings(deniedPaths: string[]): Promise<AiAccessSettingsResponse> {
      const res = await authedFetch(`${apiBase}/settings/ai-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deniedPaths }),
      });
      await assertOk(res);
      return parseJsonResponse<AiAccessSettingsResponse>(res, schemas.aiAccessSettingsResponse);
    },

    async getWelcomePageSettings(): Promise<WelcomePageSettingsResponse> {
      const res = await authedFetch(`${apiBase}/settings/welcome-page`);
      if (!res.ok) return { ok: false, path: null };
      return parseJsonResponse<WelcomePageSettingsResponse>(res, schemas.welcomePageSettingsResponse);
    },

    async updateWelcomePageSettings(path: string | null): Promise<WelcomePageSettingsResponse> {
      const res = await authedFetch(`${apiBase}/settings/welcome-page`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      await assertOk(res);
      return parseJsonResponse<WelcomePageSettingsResponse>(res, schemas.welcomePageSettingsResponse);
    },

    async getThemeSettings(): Promise<ThemeSettingsResponse> {
      const res = await authedFetch(`${apiBase}/settings/theme`);
      if (!res.ok) return { ok: false, content: "" };
      return parseJsonResponse<ThemeSettingsResponse>(res, schemas.themeSettingsResponse);
    },

    async updateThemeSettings(content: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/settings/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async listTriggers(agentId: string): Promise<TriggerInfo[]> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/triggers`);
      await assertOk(res);
      return parseJsonResponse<TriggerInfo[]>(res, schemas.triggerListResponse);
    },

    async createTrigger(agentId: string, data: {
      name?: string;
      type: "time" | "event";
      cron?: string;
      eventName?: string;
      mode: "new_session" | "existing_session" | "reusable_session";
      targetSessionId?: string;
      message: string;
      notify: boolean;
      notificationMessage?: string;
    }): Promise<TriggerEntry> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await assertOk(res);
      return parseJsonResponse<TriggerEntry>(res, schemas.triggerEntry);
    },

    async updateTrigger(agentId: string, triggerId: string, data: {
      name?: string;
      enabled?: boolean;
      type?: "time" | "event";
      cron?: string;
      eventName?: string;
      mode?: "new_session" | "existing_session" | "reusable_session";
      targetSessionId?: string;
      message?: string;
      notify?: boolean;
      notificationMessage?: string;
    }): Promise<TriggerEntry> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/triggers/${encodeURIComponent(triggerId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await assertOk(res);
      return parseJsonResponse<TriggerEntry>(res, schemas.triggerEntry);
    },

    async deleteTrigger(agentId: string, triggerId: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/triggers/${encodeURIComponent(triggerId)}`, {
        method: "DELETE",
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async runTrigger(agentId: string, triggerId: string): Promise<{ ok: boolean }> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/triggers/${encodeURIComponent(triggerId)}/run`, {
        method: "POST",
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },

    async resetTriggerBinding(agentId: string, triggerId: string): Promise<TriggerEntry> {
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/triggers/${encodeURIComponent(triggerId)}/reset-binding`, {
        method: "POST",
      });
      await assertOk(res);
      return parseJsonResponse<TriggerEntry>(res, schemas.triggerEntry);
    },

    async getTriggerLogs(agentId: string, limit?: number): Promise<TriggerLogEntry[]> {
      const params = limit ? `?limit=${limit}` : "";
      const res = await authedFetch(`${apiBase}/agents/${encodeURIComponent(agentId)}/trigger-logs${params}`);
      await assertOk(res);
      return parseJsonResponse<TriggerLogEntry[]>(res, schemas.triggerLogListResponse);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function buildWsUrl(baseUrl: string, path: string, accessToken?: string | null): string {
  const wsBase = baseUrl.replace(/^http/, "ws");
  const url = `${wsBase}${path}`;
  if (!accessToken) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(accessToken)}`;
}
