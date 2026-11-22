import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AccessDeniedError,
  ConflictError,
  NotFoundError,
  type ProjectManager,
  type ProjectRuntime,
  type SessionManager,
  type TriggerManager,
} from "@spherse/core";
import type { RpcServerFrame, RpcCallFrame } from "@spherse/contracts";

export const SERVER_VERSION = "0.1.0";
export const API_VERSION = "1";

export class RpcAppError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface RpcLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface ChatMessageAttachment {
  type: string;
  path: string;
  mimeType: string;
}

export type ControlRequestDecision =
  | { approved: boolean; reason?: string }
  | { answer?: string; timedOut: boolean };

export interface ChatAttachment {
  ready: Promise<void>;
  sendMessage(content: string, attachments?: ChatMessageAttachment[], clientId?: string): Promise<void>;
  retryLastTurn(): Promise<void>;
  withdrawLastTurn(): Promise<void>;
  abort(): void;
  resolveControlRequest(requestId: string, decision: ControlRequestDecision): void;
  close(): void;
}

export interface RpcChatHub {
  attach(
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
    subscriber: (event: unknown) => void,
    options?: { since?: number },
  ): ChatAttachment;
  startDetachedRun(
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
    content: string,
  ): Promise<void>;
}

export interface RpcProjectContext {
  runtime: ProjectRuntime;
  projectManager: ProjectManager;
  sessionRuntime: SessionManager;
  triggerManager: TriggerManager;
}

export interface RpcProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  lastOpened?: string;
}

export interface RpcRegistry {
  getSupportedProviders(): unknown;
  listInfo(): RpcProjectInfo[];
  getInfo(projectId: string): RpcProjectInfo | undefined;
}

export interface RpcModelSettings {
  sanitize(): unknown;
  apply(req: unknown): unknown;
}

export interface RpcContext {
  resolveProject(projectId: string): RpcProjectContext;
  registry: RpcRegistry;
  modelSettings: RpcModelSettings;
  authRequired: boolean;
  appVersion: string | null;
  hub: RpcChatHub;
}

export interface RpcMethodEntry {
  params: TSchema;
  handler(params: unknown, ctx: RpcContext, conn: RpcConnectionState): unknown;
}

export interface RpcConnectionState {
  chatAttachment(projectId: string, agentId: string, sessionId: string): ChatAttachment | undefined;
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
  private readonly logger: RpcLogger;

  constructor(options: {
    methods: Map<string, RpcMethodEntry>;
    ctx: RpcContext;
    logger: RpcLogger;
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
