import type { FastifyBaseLogger } from "fastify";
import type { TriggerEventPayload, TriggerManager, ProjectManager } from "@spherse/core";
import { acquireFsWatch, releaseFsWatch } from "./fs-watcher.js";
import type { FsWatchListener } from "./fs-watcher.js";
import { addDebugSubscriber, removeDebugSubscriber } from "../lib/debug-sink.js";
import type { DebugSubscriber } from "../lib/debug-sink.js";
import type { ProjectRegistry } from "../registry.js";

export type BusChannel = "trigger" | "agent" | "session" | "fs-watch" | "debug";

export interface BusEmit {
  (type: string, payload: unknown): void;
}

const TRIGGER_EVENT_TYPES = ["trigger_triggered", "trigger_completed", "trigger_failed", "trigger_updated"] as const;

function buildTriggerPayload(type: string, payload: TriggerEventPayload) {
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
    default:
      return payload;
  }
}

export type BusAttachResult =
  | { ok: true; detach: () => void }
  | { ok: false; error: string };

export function attachBusChannel(
  registry: ProjectRegistry,
  projectId: string,
  channel: BusChannel,
  emit: BusEmit,
  logger: FastifyBaseLogger,
): BusAttachResult {
  if (channel !== "debug") {
    const ctx = registry.get(projectId);
    if (!ctx) {
      return { ok: false, error: `Unknown project: ${projectId}` };
    }
    switch (channel) {
      case "trigger": {
        const triggerManager = ctx.triggerManager as TriggerManager & {
          on(type: string, handler: (payload: TriggerEventPayload) => void): void;
          off(type: string, handler: (payload: TriggerEventPayload) => void): void;
        };
        const handlers = new Map<string, (payload: TriggerEventPayload) => void>();
        for (const type of TRIGGER_EVENT_TYPES) {
          const handler = (payload: TriggerEventPayload) => {
            emit(type, buildTriggerPayload(type, payload));
          };
          handlers.set(type, handler);
          triggerManager.on(type, handler);
        }
        return {
          ok: true,
          detach: () => {
            for (const [type, handler] of handlers) triggerManager.off(type, handler);
          },
        };
      }
      case "agent": {
        const projectManager = ctx.projectManager as ProjectManager & {
          onAgentChange(handler: (payload: { agentId: string; action: string }) => void): void;
          offAgentChange(handler: (payload: { agentId: string; action: string }) => void): void;
        };
        const handler = (payload: { agentId: string; action: string }) => {
          emit("agent_updated", { agentId: payload.agentId, action: payload.action });
        };
        projectManager.onAgentChange(handler);
        return {
          ok: true,
          detach: () => projectManager.offAgentChange(handler),
        };
      }
      case "session": {
        const projectManager = ctx.projectManager as ProjectManager & {
          onSessionChange(handler: (payload: { agentId: string; sessionId: string; action: string }) => void): void;
          offSessionChange(handler: (payload: { agentId: string; sessionId: string; action: string }) => void): void;
        };
        const handler = (payload: { agentId: string; sessionId: string; action: string }) => {
          emit("session_updated", {
            agentId: payload.agentId,
            sessionId: payload.sessionId,
            action: payload.action,
          });
        };
        projectManager.onSessionChange(handler);
        return {
          ok: true,
          detach: () => projectManager.offSessionChange(handler),
        };
      }
      case "fs-watch": {
        const listener: FsWatchListener = (_projectId, evt) => {
          emit("change", { eventType: evt.eventType, path: evt.path });
        };
        const result = acquireFsWatch(ctx.projectManager.getRootPath(), projectId, listener);
        if (!result.ok) {
          logger.debug({ err: result.error }, "bus fs-watch acquire failed");
          return { ok: false, error: result.error.message };
        }
        return {
          ok: true,
          detach: () => releaseFsWatch(projectId, listener),
        };
      }
    }
  }
  const subscriber: DebugSubscriber = (envelopeJson) => {
    try {
      const parsed = JSON.parse(envelopeJson) as { type?: unknown; payload?: unknown };
      if (typeof parsed.type === "string") {
        emit(parsed.type, parsed.payload ?? {});
        return;
      }
    } catch {
      /* drop unparseable debug envelope */
    }
  };
  addDebugSubscriber(subscriber);
  return {
    ok: true,
    detach: () => removeDebugSubscriber(subscriber),
  };
}
