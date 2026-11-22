import {
  chatScope,
  parseBusScope,
  parseChatScope,
  parseRpcClientFrame,
  RpcErrorCode,
  type RpcEventFrame,
  type RpcServerFrame,
} from "@spherse/contracts";
import {
  toAppError,
  type ChatAttachment,
  type RpcChatHub,
  type RpcContext,
  type RpcDispatcher,
  type RpcLogger,
} from "./context.js";

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

export interface RpcSocket {
  send(data: string): void;
}

export class RpcConnectionHandler {
  private readonly subscriptions = new Map<string, ChatAttachment>();
  private readonly busDetaches = new Map<string, () => void>();

  constructor(
    private readonly socket: RpcSocket,
    private readonly dispatcher: RpcDispatcher,
    private readonly hub: RpcChatHub,
    private readonly ctx: RpcContext,
    private readonly logger: RpcLogger,
  ) {}

  chatAttachment(projectId: string, agentId: string, sessionId: string): ChatAttachment | undefined {
    return this.subscriptions.get(chatScope(projectId, agentId, sessionId));
  }

  onMessage(raw: string | Uint8Array): void {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.debug({ raw: text.slice(0, 200) }, "rpc frame is not json");
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
      .dispatchCall(frame, (result) => this.send(result), this)
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
    for (const detach of this.busDetaches.values()) {
      try {
        detach();
      } catch (err) {
        this.logger.debug({ err }, "rpc bus detach failed");
      }
    }
    this.busDetaches.clear();
  }

  private handleSub(id: number, scope: string, since: number | undefined): void {
    const chat = parseChatScope(scope);
    if (chat) {
      this.handleChatSub(id, scope, chat, since);
      return;
    }
    const bus = parseBusScope(scope);
    if (bus) {
      this.handleBusSub(id, scope, bus);
      return;
    }
    this.send({
      type: "result",
      id,
      ok: false,
      error: { code: RpcErrorCode.ScopeNotSupported, message: `Scope not supported: ${scope}` },
    });
  }

  private handleBusSub(id: number, scope: string, bus: { projectId: string; channel: string }): void {
    if (!this.ctx.bus) {
      this.send({
        type: "result",
        id,
        ok: false,
        error: {
          code: RpcErrorCode.ScopeNotSupported,
          message: `Bus scopes not supported by this host`,
        },
      });
      return;
    }
    let result;
    try {
      result = this.ctx.bus.attach(bus.projectId, bus.channel, (event) => {
        this.send({
          type: "event",
          scope,
          event: event.type,
          payload: event.payload,
          ts: Date.now(),
        });
      });
    } catch (err) {
      this.send({
        type: "result",
        id,
        ok: false,
        error: {
          code: toAppError(err).code,
          message: err instanceof Error ? err.message : "bus subscribe failed",
        },
      });
      return;
    }
    if (!result.ok) {
      this.send({
        type: "result",
        id,
        ok: false,
        error: { code: RpcErrorCode.AppNotFound, message: result.error },
      });
      return;
    }
    this.busDetaches.get(scope)?.();
    this.busDetaches.set(scope, result.detach);
    this.send({ type: "snapshot", id, events: [] });
  }

  private handleChatSub(
    id: number,
    scope: string,
    chat: { projectId: string; agentId: string; sessionId: string },
    since: number | undefined,
  ): void {
    let attachment: ChatAttachment;
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
          code: toAppError(err).code,
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
    const detach = this.busDetaches.get(scope);
    if (detach) {
      this.busDetaches.delete(scope);
      try {
        detach();
      } catch (err) {
        this.logger.debug({ err }, "rpc bus detach failed");
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
