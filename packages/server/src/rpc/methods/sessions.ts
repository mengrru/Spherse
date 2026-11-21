import { Type } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import { RpcAppError, defineRpcMethod } from "../context.js";

const listProject = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    perPage: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }),
  (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    return parseContract(schemas.projectSessionListResponse, {
      ok: true,
      ...projectManager.listProjectSessions(params.perPage ?? 10),
    });
  },
);

const search = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    q: Type.String(),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }),
  (params, ctx) => {
    const q = params.q.trim();
    if (!q) return parseContract(schemas.sessionSearchResponse, { results: [] });
    const { projectManager } = ctx.resolveProject(params.projectId);
    return parseContract(schemas.sessionSearchResponse, {
      results: projectManager.searchProjectMessages(q, params.limit ?? 50),
    });
  },
);

const listByAgent = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    agentId: Type.String(),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    if (params.limit !== undefined) {
      return parseContract(
        schemas.sessionListPageResponse,
        projectManager.listSessionsPage(params.agentId, params.limit, params.offset ?? 0),
      );
    }
    return parseContract(schemas.sessionListResponse, projectManager.listSessions(params.agentId));
  },
);

const get = defineRpcMethod(
  Type.Object({ projectId: Type.String(), agentId: Type.String(), sessionId: Type.String() }),
  (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const session = projectManager.getSession(params.agentId, params.sessionId);
    if (!session) throw new RpcAppError(100, "Session not found");
    return parseContract(schemas.sessionInfo, session);
  },
);

const create = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    agentId: Type.String(),
    title: Type.Optional(Type.String({ minLength: 1 })),
  }),
  async (params, ctx) => {
    const { sessionRuntime } = ctx.resolveProject(params.projectId);
    const sessionId = await sessionRuntime.createSession(params.agentId, undefined, params.title);
    return parseContract(schemas.sessionCreateResponse, { sessionId });
  },
);

const messages = defineRpcMethod(
  Type.Object({ projectId: Type.String(), agentId: Type.String(), sessionId: Type.String() }),
  (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    return parseContract(
      schemas.sessionMessagesResponse,
      projectManager.getSessionHistory(params.agentId, params.sessionId),
    );
  },
);

const messagesPage = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    agentId: Type.String(),
    sessionId: Type.String(),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    before: Type.Optional(Type.Integer()),
  }),
  (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    return parseContract(
      schemas.sessionMessagesPageResponse,
      projectManager.getRecentSessionHistory(
        params.agentId,
        params.sessionId,
        params.limit ?? 20,
        params.before,
      ),
    );
  },
);

const rename = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    agentId: Type.String(),
    sessionId: Type.String(),
    title: Type.String(),
  }),
  (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    return parseContract(
      schemas.sessionInfo,
      projectManager.renameSession(params.agentId, params.sessionId, params.title),
    );
  },
);

const remove = defineRpcMethod(
  Type.Object({ projectId: Type.String(), agentId: Type.String(), sessionId: Type.String() }),
  (params, ctx) => {
    const { runtime } = ctx.resolveProject(params.projectId);
    runtime.deleteSession(params.agentId, params.sessionId);
    return parseContract(schemas.okResponse, { ok: true });
  },
);

export const sessionMethods: Record<string, ReturnType<typeof defineRpcMethod>> = {
  "sessions.listProject": listProject,
  "sessions.search": search,
  "sessions.listByAgent": listByAgent,
  "sessions.get": get,
  "sessions.create": create,
  "sessions.messages": messages,
  "sessions.messagesPage": messagesPage,
  "sessions.rename": rename,
  "sessions.delete": remove,
};
