import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import {
  parseRpcClientFrame,
  type RpcServerFrame,
  RpcErrorCode,
} from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import { RpcAppError, RpcDispatcher, sessionMethods, type RpcMethodEntry } from "./methods/sessions.js";

export class RpcConnectionHandler {
  constructor(
    private readonly socket: Pick<WebSocket, "send">,
    private readonly dispatcher: RpcDispatcher,
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
    if (frame.type === "sub" || frame.type === "unsub") {
      this.send({
        type: "result",
        id: frame.id,
        ok: false,
        error: {
          code: RpcErrorCode.ScopeNotSupported,
          message: `Scope not supported: ${frame.scope}`,
        },
      });
      return;
    }
    void this.dispatcher
      .dispatchCall(frame, (result) => this.send(result))
      .catch((err) => this.logger.error({ err }, "rpc dispatch failed"));
  }

  onClose(): void {}

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
): void {
  const methods = new Map<string, RpcMethodEntry>(Object.entries(sessionMethods));
  fastify.get("/ws/rpc", { websocket: true }, (socket) => {
    const dispatcher = new RpcDispatcher({
      methods,
      ctx: {
        resolveProject(projectId: string) {
          const project = registry.get(projectId);
          if (!project) throw new RpcAppError(RpcErrorCode.AppNotFound, "Unknown project");
          return project;
        },
      },
      logger: fastify.log,
    });
    const handler = new RpcConnectionHandler(socket, dispatcher, fastify.log);
    socket.on("message", (raw: Buffer) => handler.onMessage(raw));
    socket.on("close", () => handler.onClose());
    socket.on("error", () => handler.onClose());
  });
}
