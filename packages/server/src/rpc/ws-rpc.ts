import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import {
  parseChatScope,
  parseRpcClientFrame,
  type RpcEventFrame,
  type RpcServerFrame,
  RpcErrorCode,
} from "@spherse/contracts";
import type { ModelCatalog } from "@spherse/core";
import type { ProjectRegistry } from "../registry.js";
import type { ChatSessionHub } from "../chat/index.js";
import type { ChatSessionAttachment } from "../chat/chat-channel.js";
import type { ModelSettingsStore } from "../model-settings.js";
import { getAppVersion } from "../server-info.js";
import { RpcAppError, RpcDispatcher, type RpcContext } from "./context.js";
import { buildMethodRegistry } from "./methods/registry.js";

export interface RpcServerOptions {
  modelSettingsStore: ModelSettingsStore;
  modelCatalog: ModelCatalog;
  authRequired: boolean;
}

function toChatEventFrame(scope: string, ev: unknown): RpcEventFrame {
  const e = ev as { type?: unknown; time?: unknown };
  return {
    type: "event",
    scope,
    event: typeof e.type === "string" ? e.type : "unknown",
    payload: ev,
    ts: typeof e.time === "number" ? e.time : Date.now(),
  };
}

export class RpcConnectionHandler {
  private readonly subscriptions = new Map<string, ChatSessionAttachment>();

  constructor(
    private readonly socket: Pick<WebSocket, "send">,
    private readonly dispatcher: RpcDispatcher,
    private readonly hub: ChatSessionHub,
    private readonly ctx: RpcContext,
    private readonly logger: FastifyBaseLogger,
  ) {}

  onMessage(raw: Buffer): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      this.logger.debug({ raw: raw.toString("utf8").slice(0, 200) }, "rpc frame is not json");
      return;
    }
    let frame;
    try {
      frame = parseRpcClientFrame(parsed);
    } catch (err) {
      this.logger.debug({ err }, "rpc frame rejected");
      return;
    }
    if (frame.type === "ping") {
      this.send({ type: "pong" });
      return;
    }
    if (frame.type === "sub") {
      this.handleSub(frame.id, frame.scope, frame.since);
      return;
    }
    if (frame.type === "unsub") {
      this.handleUnsub(frame.id, frame.scope);
      return;
    }
    void this.dispatcher
      .dispatchCall(frame, (result) => this.send(result))
      .catch((err) => this.logger.error({ err }, "rpc dispatch failed"));
  }

  onClose(): void {
    for (const attachment of this.subscriptions.values()) {
      try {
        attachment.close();
      } catch (err) {
        this.logger.debug({ err }, "rpc attachment close failed");
      }
    }
    this.subscriptions.clear();
  }

  private handleSub(id: number, scope: string, since: number | undefined): void {
    const chat = parseChatScope(scope);
    if (!chat) {
      this.send({
        type: "result",
        id,
        ok: false,
        error: { code: RpcErrorCode.ScopeNotSupported, message: `Scope not supported: ${scope}` },
      });
      return;
    }
    let attachment: ChatSessionAttachment;
    try {
      const project = this.ctx.resolveProject(chat.projectId);
      attachment = this.hub.attach(
        project.sessionRuntime,
        chat.agentId,
        chat.sessionId,
        (ev) => this.send(toChatEventFrame(scope, ev)),
        since !== undefined ? { since } : undefined,
      );
    } catch (err) {
      this.send({
        type: "result",
        id,
        ok: false,
        error: {
          code: err instanceof RpcAppError ? err.code : RpcErrorCode.InternalError,
          message: err instanceof Error ? err.message : "subscribe failed",
        },
      });
      return;
    }
    const previous = this.subscriptions.get(scope);
    if (previous) {
      try {
        previous.close();
      } catch {
        /* already closed */
      }
    }
    this.subscriptions.set(scope, attachment);
    this.send({ type: "snapshot", id, events: [] });
    attachment.ready.catch((err) => {
      this.send(
        toChatEventFrame(scope, {
          type: "error",
          message: err instanceof Error ? err.message : "session attach failed",
        }),
      );
    });
  }

  private handleUnsub(id: number, scope: string): void {
    const attachment = this.subscriptions.get(scope);
    if (attachment) {
      this.subscriptions.delete(scope);
      try {
        attachment.close();
      } catch (err) {
        this.logger.debug({ err }, "rpc attachment close failed");
      }
    }
    this.send({ type: "result", id, ok: true, data: { ok: true } });
  }

  private send(frame: RpcServerFrame): void {
    try {
      this.socket.send(JSON.stringify(frame));
    } catch {
      /* socket already closed */
    }
  }
}

export function handleRpcWebSocket(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
  hub: ChatSessionHub,
  options: RpcServerOptions,
): void {
  const methods = buildMethodRegistry();
  const ctx: RpcContext = {
    resolveProject(projectId: string) {
      const project = registry.get(projectId);
      if (!project) throw new RpcAppError(RpcErrorCode.AppNotFound, "Unknown project");
      return project;
    },
    registry,
    modelSettingsStore: options.modelSettingsStore,
    modelCatalog: options.modelCatalog,
    authRequired: options.authRequired,
    appVersion: getAppVersion() ?? null,
  };
  fastify.get("/ws/rpc", { websocket: true }, (socket) => {
    const dispatcher = new RpcDispatcher({ methods, ctx, logger: fastify.log });
    const handler = new RpcConnectionHandler(socket, dispatcher, hub, ctx, fastify.log);
    socket.on("message", (raw: Buffer) => handler.onMessage(raw));
    socket.on("close", () => handler.onClose());
    socket.on("error", () => handler.onClose());
  });
}
