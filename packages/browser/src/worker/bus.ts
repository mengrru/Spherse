import type { ProjectManager, TriggerEventPayload, TriggerManager } from "@spherse/core";
import type { RpcBusSource } from "@spherse/rpc/host";
import type { BrowserProjectRegistry } from "./registry.js";

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

type BusAttachResult =
  | { ok: true; detach: () => void }
  | { ok: false; error: string };

function attachBusChannel(
  registry: BrowserProjectRegistry,
  projectId: string,
  channel: string,
  emit: (type: string, payload: unknown) => void,
): BusAttachResult {
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
    case "fs-watch":
      return { ok: false, error: "fs-watch channel is not supported in the browser runtime" };
    default:
      return { ok: false, error: `Unsupported bus channel: ${channel}` };
  }
}

export function createWorkerBusSource(registry: BrowserProjectRegistry): RpcBusSource {
  return {
    attach: (projectId, channel, emit) =>
      attachBusChannel(registry, projectId, channel, (type, payload) => emit({ type, payload })),
  };
}
