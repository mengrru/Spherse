import { Writable } from "node:stream";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { TriggerEventPayload, TriggerManager } from "@spherse/core";
import { parseBusClientMessage } from "@spherse/server/contracts";
import type { ProjectRegistry } from "./registry.js";
import { acquireFsWatch, releaseFsWatch } from "./lib/fs-watcher.js";
import type { FsWatchListener } from "./lib/fs-watcher.js";

type DebugSubscriber = (envelopeJson: string) => void;

const debugSubscribers = new Set<DebugSubscriber>();

export function addDebugSubscriber(fn: DebugSubscriber): void {
  debugSubscribers.add(fn);
}

export function removeDebugSubscriber(fn: DebugSubscriber): void {
  debugSubscribers.delete(fn);
}

export function createDebugBusStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      const line = chunk.toString().trim();
      if (!line) {
        callback();
        return;
      }
      const envelopeJson = JSON.stringify({ channel: "debug", type: "log", payload: { line } });
      for (const fn of debugSubscribers) {
        try {
          fn(envelopeJson);
        } catch { /* stale subscriber */ }
      }
      callback();
    },
  });
}

const EVENT_TYPES = ["trigger_triggered", "trigger_completed", "trigger_failed", "trigger_updated"] as const;
type TriggerEventType = (typeof EVENT_TYPES)[number];

type BusChannel = "trigger" | "fs-watch" | "debug";

interface TriggerHandle {
  triggerManager: TriggerManager;
  handlers: Map<TriggerEventType, (payload: TriggerEventPayload) => void>;
}

function buildTriggerPayload(type: TriggerEventType, payload: TriggerEventPayload) {
  switch (type) {
    case "trigger_triggered":
      return {
        agentId: payload.agentId,
        triggerId: payload.triggerId,
        eventName: payload.eventName,
        sessionId: payload.sessionId,
        triggeredAt: payload.triggeredAt!,
      };
    case "trigger_completed":
      return {
        agentId: payload.agentId,
        triggerId: payload.triggerId,
        sessionId: payload.sessionId!,
        status: "success" as const,
      };
    case "trigger_failed":
      return {
        agentId: payload.agentId,
        triggerId: payload.triggerId,
        error: payload.error!,
      };
    case "trigger_updated":
      return {
        agentId: payload.agentId,
        triggerId: payload.triggerId,
        trigger: payload.trigger,
      };
  }
}

class BusConnectionHandler {
  private readonly subscriptions = new Set<string>();
  private readonly triggerHandles = new Map<string, TriggerHandle>();
  private readonly fsWatchListener: FsWatchListener = (projectId, evt) => {
    this.safeSend({
      channel: "fs-watch",
      projectId,
      type: "change",
      payload: { eventType: evt.eventType, path: evt.path },
    });
  };
  private readonly debugSend: DebugSubscriber = (envelopeJson) => {
    this.safeSend(envelopeJson);
  };
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
    switch (channel) {
      case "trigger": {
        const ctx = this.registry.get(projectId);
        if (!ctx) {
          this.logger.debug({ projectId }, "bus subscribe trigger: unknown project");
          return;
        }
        const handlers = new Map<TriggerEventType, (payload: TriggerEventPayload) => void>();
        for (const type of EVENT_TYPES) {
          const handler = (payload: TriggerEventPayload) => {
            this.safeSend({
              channel: "trigger",
              projectId,
              type,
              payload: buildTriggerPayload(type, payload),
            });
          };
          handlers.set(type, handler);
          ctx.triggerManager.on(type, handler);
        }
        this.triggerHandles.set(projectId, { triggerManager: ctx.triggerManager, handlers });
        this.subscriptions.add(key);
        break;
      }
      case "fs-watch": {
        const ctx = this.registry.get(projectId);
        if (!ctx) {
          this.logger.debug({ projectId }, "bus subscribe fs-watch: unknown project");
          return;
        }
        const projectRoot = ctx.projectManager.getRootPath();
        const result = acquireFsWatch(projectRoot, projectId, this.fsWatchListener);
        if (!result.ok) {
          this.safeSend({
            channel: "__system__",
            projectId,
            type: "fs_watch_error",
            payload: { error: result.error.message },
          });
          return;
        }
        this.subscriptions.add(key);
        break;
      }
      case "debug": {
        addDebugSubscriber(this.debugSend);
        this.subscriptions.add(key);
        break;
      }
    }
  }

  private unsubscribe(projectId: string, channel: BusChannel): void {
    const key = `${projectId}::${channel}`;
    if (!this.subscriptions.has(key)) return;
    this.subscriptions.delete(key);
    this.releaseSubscription(projectId, channel);
  }

  private releaseSubscription(projectId: string, channel: BusChannel): void {
    switch (channel) {
      case "trigger": {
        const handle = this.triggerHandles.get(projectId);
        if (handle) {
          for (const [type, handler] of handle.handlers) {
            handle.triggerManager.off(type, handler);
          }
          this.triggerHandles.delete(projectId);
        }
        break;
      }
      case "fs-watch":
        releaseFsWatch(projectId, this.fsWatchListener);
        break;
      case "debug":
        removeDebugSubscriber(this.debugSend);
        break;
    }
  }

  onClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const key of this.subscriptions) {
      const sep = key.indexOf("::");
      const projectId = key.slice(0, sep);
      const channel = key.slice(sep + 2) as BusChannel;
      this.releaseSubscription(projectId, channel);
    }
    this.subscriptions.clear();
  }

  private safeSend(msg: object | string): void {
    try {
      this.socket.send(typeof msg === "string" ? msg : JSON.stringify(msg));
    } catch { /* socket already closed */ }
  }
}

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
