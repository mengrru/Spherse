import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyBaseLogger } from "fastify";
import {
  AccessDeniedError,
  ConflictError,
  NotFoundError,
  type ModelCatalog,
} from "@spherse/core";
import type { RpcServerFrame, RpcCallFrame } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import type { ModelSettingsStore } from "../model-settings.js";
import type { ProjectContextCompat } from "../registry.js";
import type { ChatSessionAttachment } from "../chat/chat-channel.js";

export class RpcAppError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface RpcContext {
  resolveProject(projectId: string): ProjectContextCompat;
  registry: ProjectRegistry;
  modelSettingsStore: ModelSettingsStore;
  modelCatalog: ModelCatalog;
  authRequired: boolean;
  appVersion: string | null;
}

export interface RpcMethodEntry {
  params: TSchema;
  handler(params: unknown, ctx: RpcContext, conn: RpcConnectionState): unknown;
}

export interface RpcConnectionState {
  chatAttachment(projectId: string, agentId: string, sessionId: string): ChatSessionAttachment | undefined;
}

export function defineRpcMethod<P extends TSchema>(
  params: P,
  handler: (params: Static<P>, ctx: RpcContext, conn: RpcConnectionState) => unknown,
): RpcMethodEntry {
  return {
    params,
    handler: handler as (
      params: unknown,
      ctx: RpcContext,
      conn: RpcConnectionState,
    ) => unknown,
  };
}

function toAppError(err: unknown): RpcAppError {
  if (err instanceof RpcAppError) return err;
  if (err instanceof NotFoundError) return new RpcAppError(100, err.message);
  if (err instanceof AccessDeniedError) return new RpcAppError(101, err.message);
  if (err instanceof ConflictError) return new RpcAppError(102, err.message);
  return new RpcAppError(-32603, err instanceof Error ? err.message : String(err));
}

export class RpcDispatcher {
  private readonly methods: Map<string, RpcMethodEntry>;
  private readonly ctx: RpcContext;
  private readonly logger: FastifyBaseLogger;

  constructor(options: {
    methods: Map<string, RpcMethodEntry>;
    ctx: RpcContext;
    logger: FastifyBaseLogger;
  }) {
    this.methods = options.methods;
    this.ctx = options.ctx;
    this.logger = options.logger;
  }

  async dispatchCall(
    frame: RpcCallFrame,
    send: (frame: RpcServerFrame) => void,
    conn: RpcConnectionState,
  ): Promise<void> {
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
      const data = await entry.handler(params, this.ctx, conn);
      send({ type: "result", id: frame.id, ok: true, data });
    } catch (err) {
      const appError = toAppError(err);
      if (appError.code === -32603) {
        this.logger.warn({ err, method: frame.method }, "rpc method failed");
      }
      send({
        type: "result",
        id: frame.id,
        ok: false,
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.data !== undefined ? { data: appError.data } : {}),
        },
      });
    }
  }
}
