import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { schemas, parseContract, type RpcServerFrame, type RpcCallFrame } from "@spherse/contracts";
import type { ProjectContextCompat } from "../../registry.js";
import type { FastifyBaseLogger } from "fastify";

export class RpcAppError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface RpcProjectContexts {
  resolveProject(projectId: string): ProjectContextCompat;
}

export interface RpcMethodEntry {
  params: TSchema;
  handler(params: unknown, ctx: RpcProjectContexts): unknown;
}

export function defineRpcMethod<P extends TSchema>(
  params: P,
  handler: (params: Static<P>, ctx: RpcProjectContexts) => unknown,
): RpcMethodEntry {
  return { params, handler: handler as (params: unknown, ctx: RpcProjectContexts) => unknown };
}

export interface RpcDispatcherOptions {
  methods: Map<string, RpcMethodEntry>;
  ctx: RpcProjectContexts;
  logger: FastifyBaseLogger;
}

export class RpcDispatcher {
  private readonly methods: Map<string, RpcMethodEntry>;
  private readonly ctx: RpcProjectContexts;
  private readonly logger: FastifyBaseLogger;

  constructor(options: RpcDispatcherOptions) {
    this.methods = options.methods;
    this.ctx = options.ctx;
    this.logger = options.logger;
  }

  async dispatchCall(frame: RpcCallFrame, send: (frame: RpcServerFrame) => void): Promise<void> {
    const entry = this.methods.get(frame.method);
    if (!entry) {
      send({
        type: "result",
        id: frame.id,
        ok: false,
        error: { code: -32601, message: `Method not found: ${frame.method}` },
      });
      return;
    }
    let params: unknown;
    if (frame.params === undefined) {
      params = Value.Parse(entry.params, {});
    } else if (Value.Check(entry.params, frame.params)) {
      params = Value.Parse(entry.params, frame.params);
    } else {
      send({
        type: "result",
        id: frame.id,
        ok: false,
        error: { code: -32602, message: `Invalid params for ${frame.method}` },
      });
      return;
    }
    try {
      const data = await entry.handler(params, this.ctx);
      send({ type: "result", id: frame.id, ok: true, data });
    } catch (err) {
      if (err instanceof RpcAppError) {
        send({
          type: "result",
          id: frame.id,
          ok: false,
          error: { code: err.code, message: err.message, ...(err.data !== undefined ? { data: err.data } : {}) },
        });
        return;
      }
      this.logger.warn({ err, method: frame.method }, "rpc method failed");
      send({
        type: "result",
        id: frame.id,
        ok: false,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

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

export const sessionMethods: Record<string, RpcMethodEntry> = {
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
