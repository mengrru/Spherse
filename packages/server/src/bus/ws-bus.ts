import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { parseBusClientMessage } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import { attachBusChannel, type BusChannel } from "./bus-channels.js";

export function handleBusWebSocket(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
): void {
  fastify.get("/ws/bus", { websocket: true }, (socket) => {
    const handler = new BusConnectionHandler(socket, registry, fastify.log);
    socket.on("message", (raw: Buffer) => handler.onMessage(raw));
    socket.on("close", () => handler.onClose());
    socket.on("error", () => handler.onClose());
  });
}

class BusConnectionHandler {
  private readonly subscriptions = new Map<string, () => void>();
  private closed = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly registry: ProjectRegistry,
    private readonly logger: FastifyBaseLogger,
  ) {}

  onMessage(raw: Buffer | string): void {
    let msg;
    try {
      msg = parseBusClientMessage(JSON.parse(raw.toString()));
    } catch (err) {
      this.logger.debug({ err }, "invalid bus ws message");
      return;
    }
    switch (msg.kind) {
      case "subscribe":
        this.subscribe(msg.projectId, msg.channel);
        break;
      case "unsubscribe":
        this.unsubscribe(msg.projectId, msg.channel);
        break;
      case "ping":
        this.safeSend({ channel: "__system__", type: "pong", payload: {} });
        break;
      case "emit-trigger-event": {
        const ctx = this.registry.get(msg.projectId);
        if (!ctx) {
          this.logger.debug({ projectId: msg.projectId }, "emit-trigger-event: unknown project");
          return;
        }
        ctx.triggerManager.onUserEvent(msg.eventName, msg.payload ?? "");
        break;
      }
    }
  }

  private subscribe(projectId: string, channel: BusChannel): void {
    const key = `${projectId}::${channel}`;
    if (this.subscriptions.has(key)) return;
    if (channel !== "debug" && !this.registry.get(projectId)) {
      this.logger.debug({ projectId, channel }, "bus subscribe: unknown project");
      return;
    }
    const result = attachBusChannel(this.registry, projectId, channel, (type, payload) => {
      this.safeSend({
        channel,
        ...(channel === "debug" ? {} : { projectId }),
        type,
        payload,
      });
    }, this.logger);
    if (!result.ok) {
      if (channel === "fs-watch") {
        this.safeSend({
          channel: "__system__",
          projectId,
          type: "fs_watch_error",
          payload: { error: result.error },
        });
        return;
      }
      this.logger.debug({ projectId, channel, error: result.error }, "bus subscribe failed");
      return;
    }
    this.subscriptions.set(key, result.detach);
  }

  private unsubscribe(projectId: string, channel: BusChannel): void {
    const key = `${projectId}::${channel}`;
    const detach = this.subscriptions.get(key);
    if (!detach) return;
    this.subscriptions.delete(key);
    detach();
  }

  onClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const detach of this.subscriptions.values()) detach();
    this.subscriptions.clear();
  }

  private safeSend(msg: object | string): void {
    try {
      this.socket.send(typeof msg === "string" ? msg : JSON.stringify(msg));
    } catch { /* socket already closed */ }
  }
}
