import { Writable } from "node:stream";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { ScheduleEventPayload, Scheduler } from "@spherse/core";
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

const EVENT_TYPES = ["schedule_triggered", "schedule_completed", "schedule_failed", "schedule_updated"] as const;
type ScheduleEventType = (typeof EVENT_TYPES)[number];

type BusChannel = "schedule" | "fs-watch" | "debug";

interface ScheduleHandle {
  scheduler: Scheduler;
  handlers: Map<ScheduleEventType, (payload: ScheduleEventPayload) => void>;
}

function buildSchedulePayload(type: ScheduleEventType, payload: ScheduleEventPayload) {
  switch (type) {
    case "schedule_triggered":
      return {
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        sessionId: payload.sessionId,
        triggeredAt: payload.triggeredAt!,
      };
    case "schedule_completed":
      return {
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        sessionId: payload.sessionId!,
        status: "success" as const,
      };
    case "schedule_failed":
      return {
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        error: payload.error!,
      };
    case "schedule_updated":
      return {
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        schedule: payload.schedule,
      };
  }
}

class BusConnectionHandler {
  private readonly subscriptions = new Set<string>();
  private readonly scheduleHandles = new Map<string, ScheduleHandle>();
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
    }
  }

  private subscribe(projectId: string, channel: BusChannel): void {
    const key = `${projectId}::${channel}`;
    if (this.subscriptions.has(key)) return;
    switch (channel) {
      case "schedule": {
        const ctx = this.registry.get(projectId);
        if (!ctx) {
          this.logger.debug({ projectId }, "bus subscribe schedule: unknown project");
          return;
        }
        const handlers = new Map<ScheduleEventType, (payload: ScheduleEventPayload) => void>();
        for (const type of EVENT_TYPES) {
          const handler = (payload: ScheduleEventPayload) => {
            this.safeSend({
              channel: "schedule",
              projectId,
              type,
              payload: buildSchedulePayload(type, payload),
            });
          };
          handlers.set(type, handler);
          ctx.scheduler.on(type, handler);
        }
        this.scheduleHandles.set(projectId, { scheduler: ctx.scheduler, handlers });
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
      case "schedule": {
        const handle = this.scheduleHandles.get(projectId);
        if (handle) {
          for (const [type, handler] of handle.handlers) {
            handle.scheduler.off(type, handler);
          }
          this.scheduleHandles.delete(projectId);
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
