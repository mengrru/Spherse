import { Type } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import { ValidationError } from "@spherse/core";
import { RpcAppError, defineRpcMethod, type RpcMethodEntry } from "../context.js";

async function mapMemoryError<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ValidationError) throw new RpcAppError(-32602, err.message);
    throw err;
  }
}

const list = defineRpcMethod(
  Type.Object({ projectId: Type.String() }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const agents = await projectManager.listAgents();
    return parseContract(
      schemas.agentListResponse,
      agents.map(({ id, name, alias, slug, createdAt, memory }) => ({
        id,
        name,
        ...(alias !== undefined ? { alias } : {}),
        slug,
        ...(createdAt !== undefined ? { createdAt } : {}),
        memoryEnabled: memory?.enabled === true,
      })),
    );
  },
);

const get = defineRpcMethod(
  Type.Object({ projectId: Type.String(), id: Type.String() }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const profile = await projectManager.getAgentProfile(params.id);
    if (!profile) throw new RpcAppError(100, "Agent not found");
    return parseContract(schemas.agentProfile, profile);
  },
);

const getRaw = defineRpcMethod(
  Type.Object({ projectId: Type.String(), id: Type.String() }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const raw = await projectManager.getRawContent(params.id);
    if (raw === null) throw new RpcAppError(100, "Agent not found");
    return parseContract(schemas.agentRawResponse, { content: raw });
  },
);

const getTheme = defineRpcMethod(
  Type.Object({ projectId: Type.String(), id: Type.String() }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    return projectManager.getAgentTheme(params.id);
  },
);

const create = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    slugBase: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }),
    themeContent: Type.Optional(Type.String()),
  }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const profile = await projectManager.createAgent(
      params.slugBase,
      params.content,
      params.themeContent,
    );
    return parseContract(schemas.agentCreateResponse, { ok: true, id: profile.id });
  },
);

const update = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    id: Type.String(),
    content: Type.String({ minLength: 1 }),
    themeContent: Type.Optional(Type.String()),
  }),
  async (params, ctx) => {
    const { runtime } = ctx.resolveProject(params.projectId);
    const updated = await runtime.updateAgent(params.id, params.content, params.themeContent);
    return parseContract(schemas.agentUpdateResponse, { ok: true, id: updated.id });
  },
);

const remove = defineRpcMethod(
  Type.Object({ projectId: Type.String(), id: Type.String() }),
  async (params, ctx) => {
    const { runtime } = ctx.resolveProject(params.projectId);
    await runtime.deleteAgent(params.id);
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const getMcp = defineRpcMethod(
  Type.Object({ projectId: Type.String(), id: Type.String() }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    return parseContract(schemas.agentMcpResponse, await projectManager.getAgentMcp(params.id));
  },
);

const updateMcp = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    id: Type.String(),
    servers: Type.Array(schemas.mcpServerConfig),
  }),
  async (params, ctx) => {
    const { runtime } = ctx.resolveProject(params.projectId);
    return parseContract(
      schemas.agentMcpResponse,
      await runtime.updateAgentMcp(params.id, { servers: params.servers }),
    );
  },
);

const getMemoryConfig = defineRpcMethod(
  Type.Object({ projectId: Type.String(), id: Type.String() }),
  async (params, ctx) => {
    const { runtime } = ctx.resolveProject(params.projectId);
    const memory = await mapMemoryError(() => runtime.getAgentMemory(params.id));
    return parseContract(schemas.agentMemoryResponse, memory);
  },
);

const updateMemoryConfig = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    id: Type.String(),
    enabled: Type.Optional(Type.Boolean()),
    core: Type.Optional(Type.String()),
  }),
  async (params, ctx) => {
    const { runtime } = ctx.resolveProject(params.projectId);
    const input: { enabled?: boolean; core?: string } = {};
    if (params.enabled !== undefined) input.enabled = params.enabled;
    if (params.core !== undefined) input.core = params.core;
    const memory = await mapMemoryError(() => runtime.updateAgentMemory(params.id, input));
    return parseContract(schemas.agentMemoryResponse, memory);
  },
);

const listMemoryEntries = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    id: Type.String(),
    q: Type.Optional(Type.String()),
  }),
  async (params, ctx) => {
    const { runtime } = ctx.resolveProject(params.projectId);
    const entries = await mapMemoryError(() =>
      runtime.listAgentMemoryEntries(params.id, params.q),
    );
    return parseContract(schemas.agentMemoryEntriesResponse, { entries });
  },
);

const updateMemoryEntry = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    id: Type.String(),
    entryId: Type.String(),
    content: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
  }),
  async (params, ctx) => {
    const { runtime } = ctx.resolveProject(params.projectId);
    const patch: { content?: string; tags?: string[] } = {};
    if (params.content !== undefined) patch.content = params.content;
    if (params.tags !== undefined) patch.tags = params.tags;
    const entry = await mapMemoryError(() =>
      runtime.updateAgentMemoryEntry(params.id, params.entryId, patch),
    );
    return parseContract(schemas.agentMemoryEntry, entry);
  },
);

const deleteMemoryEntry = defineRpcMethod(
  Type.Object({ projectId: Type.String(), id: Type.String(), entryId: Type.String() }),
  async (params, ctx) => {
    const { runtime } = ctx.resolveProject(params.projectId);
    await mapMemoryError(() => runtime.deleteAgentMemoryEntry(params.id, params.entryId));
    return parseContract(schemas.okResponse, { ok: true });
  },
);

export const agentMethods: Record<string, RpcMethodEntry> = {
  "agents.list": list,
  "agents.get": get,
  "agents.getRaw": getRaw,
  "agents.getTheme": getTheme,
  "agents.create": create,
  "agents.update": update,
  "agents.delete": remove,
  "agents.getMcp": getMcp,
  "agents.updateMcp": updateMcp,
  "agents.getMemoryConfig": getMemoryConfig,
  "agents.updateMemoryConfig": updateMemoryConfig,
  "agents.listMemoryEntries": listMemoryEntries,
  "agents.updateMemoryEntry": updateMemoryEntry,
  "agents.deleteMemoryEntry": deleteMemoryEntry,
};
