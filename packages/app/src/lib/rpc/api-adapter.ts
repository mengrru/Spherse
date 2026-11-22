import type { TSchema } from "@sinclair/typebox";
import { schemas, parseApiResponse } from "@spherse/contracts";
import {
  ApiError,
  attachmentUploadResponse,
  createAuthedFetch,
  type ApiClient,
  type AttachmentUploadResponse,
  type GlobalApiClient,
} from "../api.js";
import type {
  AgentMemoryEntry,
  AiAccessSettingsResponse,
  ContentResponse,
  FileEntry,
  McpServerConfig,
  SidePanelSettingsResponse,
  ThemeSettingsResponse,
  WelcomePageSettingsResponse,
} from "../types.js";
import type { AgentMcpConfig } from "../types.js";
import { RpcCallError, type RpcClient } from "./client.js";

const STATUS_BY_CODE: Record<number, number> = {
  100: 404,
  101: 403,
  102: 409,
  [-32602]: 400,
};

function toApiError(err: unknown): ApiError {
  if (err instanceof RpcCallError) {
    return new ApiError(err.message, STATUS_BY_CODE[err.code] ?? 500);
  }
  return new ApiError(err instanceof Error ? err.message : "rpc failed", 500);
}

async function rpc<T>(
  client: RpcClient,
  method: string,
  params: Record<string, unknown> | undefined,
  schema?: TSchema,
): Promise<T> {
  try {
    const data = await client.call<T>(method, params);
    return (schema ? parseApiResponse(schema, data) : data) as T;
  } catch (err) {
    throw toApiError(err);
  }
}

function catching<T>(fallback: T, err: unknown): T {
  void err;
  return fallback;
}

function encodePathSegments(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

export function createRpcApiClient(
  baseUrl: string,
  projectId: string,
  accessToken: string | null,
  rpcClient: RpcClient,
): ApiClient {
  const apiBase = `${baseUrl}/api/projects/${projectId}`;
  const authedFetch = createAuthedFetch(accessToken);

  const call = <T>(method: string, params?: Record<string, unknown>, schema?: TSchema) =>
    rpc<T>(rpcClient, method, params, schema);

  return {
    baseUrl,
    accessToken,

    async listAgents() {
      return call("agents.list", { projectId }, schemas.agentListResponse);
    },
    async getAgent(id: string) {
      return call("agents.get", { projectId, id }, schemas.agentProfile);
    },
    async createSession(agentId: string, title?: string) {
      return call(
        "sessions.create",
        { projectId, agentId, ...(title !== undefined ? { title } : {}) },
        schemas.sessionCreateResponse,
      );
    },
    async sendMessage(agentId: string, id: string, content: string) {
      return call(
        "sessions.sendMessage",
        { projectId, agentId, sessionId: id, content },
        schemas.sendMessageOkResponse,
      );
    },
    async getSession(agentId: string, id: string) {
      return call("sessions.get", { projectId, agentId, sessionId: id }, schemas.sessionInfo);
    },
    async listSessions(agentId: string) {
      return call("sessions.listByAgent", { projectId, agentId }, schemas.sessionListResponse);
    },
    async listSessionsPage(agentId: string, opts?: { limit?: number; offset?: number }) {
      return call(
        "sessions.listByAgent",
        {
          projectId,
          agentId,
          ...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
          ...(opts?.offset !== undefined ? { offset: opts.offset } : {}),
        },
        schemas.sessionListPageResponse,
      );
    },
    async listProjectSessions(opts?: { perPage?: number }) {
      return call(
        "sessions.listProject",
        { projectId, ...(opts?.perPage !== undefined ? { perPage: opts.perPage } : {}) },
        schemas.projectSessionListResponse,
      );
    },
    async searchSessions(q: string, opts?: { limit?: number }) {
      return call(
        "sessions.search",
        { projectId, q, ...(opts?.limit !== undefined ? { limit: opts.limit } : {}) },
        schemas.sessionSearchResponse,
      );
    },
    async getSessionMessages(agentId: string, id: string) {
      return call(
        "sessions.messages",
        { projectId, agentId, sessionId: id },
        schemas.sessionMessagesResponse,
      );
    },
    async getSessionMessagesPage(agentId: string, id: string, opts?: { limit?: number; before?: number }) {
      if (opts?.limit === undefined) {
        return call(
          "sessions.messages",
          { projectId, agentId, sessionId: id },
          schemas.sessionMessagesResponse,
        ) as Promise<import("@spherse/contracts").SessionMessagesPageResponse>;
      }
      return call(
        "sessions.messagesPage",
        {
          projectId,
          agentId,
          sessionId: id,
          limit: opts.limit,
          ...(opts.before !== undefined ? { before: opts.before } : {}),
        },
        schemas.sessionMessagesPageResponse,
      );
    },
    async getSessionStatus(agentId: string, id: string) {
      return call(
        "sessions.status",
        { projectId, agentId, sessionId: id },
        schemas.sessionStatus,
      );
    },
    async renameSession(agentId: string, id: string, title: string) {
      return call("sessions.rename", { projectId, agentId, sessionId: id, title }, schemas.sessionInfo);
    },
    async deleteSession(agentId: string, id: string) {
      return call("sessions.delete", { projectId, agentId, sessionId: id }, schemas.okResponse);
    },

    async listContent(dirPath: string = "") {
      return call(
        "content.list",
        { projectId, ...(dirPath ? { path: dirPath } : {}) },
        schemas.fileEntries,
      ).catch((err: unknown) => catching([], err)) as Promise<FileEntry[]>;
    },
    async stat(filePath: string) {
      return call("content.stat", { projectId, path: filePath }, schemas.statResponse);
    },
    async getContent(filePath: string) {
      return call<ContentResponse | null>("content.read", { projectId, path: filePath }, schemas.contentResponse).catch(
        (err: unknown) => catching<ContentResponse | null>(null, err),
      );
    },
    async readContent(filePath: string) {
      return call("content.read", { projectId, path: filePath }, schemas.contentResponse);
    },
    async saveContent(filePath: string, content: string) {
      return call("content.save", { projectId, path: filePath, content }, schemas.okResponse);
    },
    async deleteContent(filePath: string) {
      return call("content.delete", { projectId, path: filePath }, schemas.okResponse);
    },
    async mkdir(dirPath: string) {
      return call("content.mkdir", { projectId, path: dirPath }, schemas.okResponse);
    },
    async touchFile(filePath: string) {
      return call("content.touch", { projectId, path: filePath }, schemas.okResponse);
    },
    async renameContent(fromPath: string, toPath: string) {
      return call("content.rename", { projectId, path: fromPath, to: toPath }, schemas.okResponse);
    },
    async getFileTree() {
      return call<string[]>("content.fileTree", { projectId }, schemas.fileTreeResponse).catch(
        (err: unknown) => catching<string[]>([], err),
      );
    },

    async dataRead(params: {
      file: string;
      key?: string;
      path?: string;
      offset?: number;
      limit?: number;
      ifVersion?: string;
    }) {
      return call("data.read", { projectId, ...params }, schemas.dataReadResponse);
    },
    async dataMutate(params: {
      file: string;
      name: string;
      args?: Record<string, unknown>;
      idempotencyKey?: string;
    }) {
      return call("data.mutate", { projectId, ...params }, schemas.dataMutateResponse);
    },
    async dataRawSet(params: { file: string; key: string; value: unknown; ifVersion?: string }) {
      return call("data.rawSet", { projectId, ...params }, schemas.dataWriteResponse);
    },
    async dataRawDelete(params: { file: string; key: string; ifVersion?: string }) {
      return call("data.rawDelete", { projectId, ...params }, schemas.dataWriteResponse);
    },

    async createAgent(slugBase: string, content: string, themeContent?: string) {
      return call(
        "agents.create",
        { projectId, slugBase, content, ...(themeContent !== undefined ? { themeContent } : {}) },
        schemas.agentCreateResponse,
      );
    },
    async getAgentRaw(id: string) {
      const data = await call<{ content: string }>("agents.getRaw", { projectId, id }, schemas.agentRawResponse);
      return data.content;
    },
    async getAgentTheme(id: string) {
      return call<string>("agents.getTheme", { projectId, id }).catch((err: unknown) =>
        catching<string>("", err),
      );
    },
    async updateAgent(id: string, content: string, themeContent?: string) {
      return call(
        "agents.update",
        { projectId, id, content, ...(themeContent !== undefined ? { themeContent } : {}) },
        schemas.agentUpdateResponse,
      );
    },
    async deleteAgent(id: string) {
      return call("agents.delete", { projectId, id }, schemas.okResponse);
    },
    async getAgentMcp(id: string) {
      return call<AgentMcpConfig>("agents.getMcp", { projectId, id }, schemas.agentMcpResponse).catch(
        (err: unknown) => catching<AgentMcpConfig>({ servers: [] }, err),
      );
    },
    async updateAgentMcp(id: string, config: { servers: McpServerConfig[] }) {
      return call(
        "agents.updateMcp",
        { projectId, id, servers: config.servers },
        schemas.agentMcpResponse,
      );
    },
    async getAgentMemory(id: string) {
      return call("agents.getMemoryConfig", { projectId, id }, schemas.agentMemoryResponse);
    },
    async updateAgentMemory(id: string, config: { enabled?: boolean; core?: string }) {
      return call(
        "agents.updateMemoryConfig",
        {
          projectId,
          id,
          ...(config.enabled !== undefined ? { enabled: config.enabled } : {}),
          ...(config.core !== undefined ? { core: config.core } : {}),
        },
        schemas.agentMemoryResponse,
      );
    },
    async listAgentMemoryEntries(id: string, query?: string) {
      const data = await call<{ entries: AgentMemoryEntry[] }>(
        "agents.listMemoryEntries",
        { projectId, id, ...(query?.trim() ? { q: query.trim() } : {}) },
        schemas.agentMemoryEntriesResponse,
      );
      return data.entries;
    },
    async updateAgentMemoryEntry(
      id: string,
      entryId: string,
      patch: { content?: string; tags?: string[] },
    ) {
      return call(
        "agents.updateMemoryEntry",
        {
          projectId,
          id,
          entryId,
          ...(patch.content !== undefined ? { content: patch.content } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        },
        schemas.agentMemoryEntry,
      );
    },
    async deleteAgentMemoryEntry(id: string, entryId: string) {
      return call("agents.deleteMemoryEntry", { projectId, id, entryId }, schemas.okResponse);
    },

    async createSkill(name: string, description: string, instructions: string) {
      return call("skills.create", { projectId, name, description, instructions }, schemas.skillDefinition);
    },
    async installSkill(zipPath: string) {
      return call("skills.install", { projectId, zipPath }, schemas.skillDefinition);
    },
    async listSkills() {
      return call("skills.list", { projectId }, schemas.skillListResponse);
    },
    async listMarketplaceSkills() {
      return call("skills.listMarketplace", { projectId }, schemas.marketplaceManifestResponse);
    },
    async installMarketplaceSkill(name: string, version: string) {
      return call("skills.installMarketplace", { projectId, name, version }, schemas.skillDefinition);
    },

    async getAiAccessSettings() {
      return call<AiAccessSettingsResponse>("settings.getAiAccess", { projectId }, schemas.aiAccessSettingsResponse).catch(
        (err: unknown) => catching<AiAccessSettingsResponse>({ ok: false, deniedPaths: [] }, err),
      );
    },
    async updateAiAccessSettings(deniedPaths: string[]) {
      return call("settings.updateAiAccess", { projectId, deniedPaths }, schemas.aiAccessSettingsResponse);
    },
    async getWelcomePageSettings() {
      return call<WelcomePageSettingsResponse>("settings.getWelcomePage", { projectId }, schemas.welcomePageSettingsResponse).catch(
        (err: unknown) => catching<WelcomePageSettingsResponse>({ ok: false, path: null }, err),
      );
    },
    async updateWelcomePageSettings(path: string | null) {
      return call("settings.updateWelcomePage", { projectId, path }, schemas.welcomePageSettingsResponse);
    },
    async getSidePanelSettings() {
      return call<SidePanelSettingsResponse>("settings.getSidePanel", { projectId }, schemas.sidePanelSettingsResponse).catch(
        (err: unknown) => catching<SidePanelSettingsResponse>({ ok: false, path: null }, err),
      );
    },
    async updateSidePanelSettings(path: string | null) {
      return call("settings.updateSidePanel", { projectId, path }, schemas.sidePanelSettingsResponse);
    },
    async getThemeSettings() {
      return call<ThemeSettingsResponse>("settings.getTheme", { projectId }, schemas.themeSettingsResponse).catch(
        (err: unknown) => catching<ThemeSettingsResponse>({ ok: false, content: "" }, err),
      );
    },
    async updateThemeSettings(content: string) {
      return call("settings.updateTheme", { projectId, content }, schemas.okResponse);
    },

    async listTriggers(agentId: string) {
      return call("triggers.list", { projectId, agentId }, schemas.triggerListResponse);
    },
    async listProjectTriggers() {
      return call("triggers.listProject", { projectId }, schemas.projectTriggerListResponse);
    },
    async createTrigger(agentId: string, data: Parameters<ApiClient["createTrigger"]>[1]) {
      return call("triggers.create", { projectId, agentId, ...data }, schemas.triggerEntry);
    },
    async updateTrigger(agentId: string, triggerId: string, data: Parameters<ApiClient["updateTrigger"]>[2]) {
      return call("triggers.update", { projectId, agentId, triggerId, ...data }, schemas.triggerEntry);
    },
    async deleteTrigger(agentId: string, triggerId: string) {
      return call("triggers.delete", { projectId, agentId, triggerId }, schemas.okResponse);
    },
    async runTrigger(agentId: string, triggerId: string) {
      return call("triggers.run", { projectId, agentId, triggerId }, schemas.okResponse);
    },
    async resetTriggerBinding(agentId: string, triggerId: string) {
      return call("triggers.resetBinding", { projectId, agentId, triggerId }, schemas.triggerEntry);
    },
    async getTriggerLogs(agentId: string, limit?: number) {
      return call(
        "triggers.logs",
        { projectId, agentId, ...(limit ? { limit } : {}) },
        schemas.triggerLogListResponse,
      );
    },

    async getTurnContext(sessionId: string) {
      return call("debug.turnContext", { projectId, sessionId }, schemas.turnContextSnapshot);
    },
    async getSessionEvents(agentId: string, sessionId: string) {
      return call("debug.sessionEvents", { projectId, agentId, sessionId }, schemas.sessionEventLog);
    },

    getPreviewUrl(filePath: string, version?: number): string {
      const encodedPath = encodePathSegments(filePath);
      const pathMiddle = accessToken
        ? `/preview/__auth/${encodeURIComponent(accessToken)}/${encodedPath}`
        : `/preview/${encodedPath}`;
      const base = `${apiBase}${pathMiddle}`;
      return version !== undefined ? `${base}?v=${version}` : base;
    },

    async downloadFile(filePath: string): Promise<Blob> {
      const res = await authedFetch(`${apiBase}/download/${encodePathSegments(filePath)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(
          body?.error ?? `HTTP ${res.status}`,
          res.status,
          typeof body?.code === "string" ? body.code : undefined,
        );
      }
      return res.blob();
    },
    async exportImage(srcRel: string, destAbs: string) {
      const res = await authedFetch(`${apiBase}/images/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: srcRel, dest: destAbs }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "request failed" }));
        throw new ApiError(body.error ?? "request failed", res.status);
      }
      return (await res.json()) as { ok: boolean };
    },
    async uploadAttachedImage(blob: Blob, meta?: { width?: number; height?: number }) {
      const form = new FormData();
      form.append("file", blob);
      if (meta?.width !== undefined) form.append("width", String(meta.width));
      if (meta?.height !== undefined) form.append("height", String(meta.height));
      const res = await authedFetch(`${apiBase}/attachments`, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "request failed" }));
        throw new ApiError(body.error ?? "request failed", res.status);
      }
      return parseApiResponse(attachmentUploadResponse, await res.json()) as AttachmentUploadResponse;
    },
    async deleteAttachment(path: string) {
      const res = await authedFetch(`${apiBase}/attachments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "request failed" }));
        throw new ApiError(body.error ?? "request failed", res.status);
      }
    },
    async uploadFile(dirPath: string, file: File) {
      const form = new FormData();
      form.append("file", file);
      const res = await authedFetch(`${apiBase}/upload/${encodeURIComponent(dirPath)}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "request failed" }));
        throw new ApiError(body.error ?? "request failed", res.status);
      }
      return parseApiResponse(schemas.uploadResponse, await res.json());
    },
  };
}

export function createRpcGlobalApiClient(
  _baseUrl: string,
  _accessToken: string | null,
  rpcClient: RpcClient,
): GlobalApiClient {
  const call = <T>(method: string, params?: Record<string, unknown>, schema?: TSchema) =>
    rpc<T>(rpcClient, method, params, schema);

  return {
    async listMarketplaceProjects() {
      return call("marketplace.projects", undefined, schemas.marketplaceProjectManifestResponse);
    },
    async installMarketplaceProject(req) {
      return call("marketplace.installProject", { ...req }, schemas.projectMarketplaceInstallResponse);
    },
    async getSupportedProviders() {
      return call("settings.supportedProviders", {}, schemas.providerCatalog);
    },
    async getImageProviders() {
      return call("settings.imageProviders", {}, schemas.providerCatalog);
    },
    async getModelSettings() {
      return call("settings.getModels", {}, schemas.modelSettingsResponse);
    },
    async getConnectionInfo() {
      return call("connection.info", {}, schemas.connectionInfoResponse);
    },
    async updateModelSettings(req) {
      return call("settings.updateModels", { ...req }, schemas.modelSettingsResponse);
    },
    async listMarketplacePrompts(language: string) {
      return call("marketplace.prompts", { language }, schemas.marketplacePromptManifestResponse);
    },
  };
}
