import type { FastifyInstance } from "fastify";
import type { ScheduleEventPayload } from "@spherse/core";
import type { ScheduleServerEvent } from "@spherse/server/contracts";
import type { ProjectRegistry } from "./registry.js";

const EVENT_TYPES = ["schedule_triggered", "schedule_completed", "schedule_failed", "schedule_updated"] as const;

function toServerEvent(type: (typeof EVENT_TYPES)[number], payload: ScheduleEventPayload): ScheduleServerEvent {
  switch (type) {
    case "schedule_triggered":
      return {
        type: "schedule_triggered",
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        sessionId: payload.sessionId,
        triggeredAt: payload.triggeredAt!,
      };
    case "schedule_completed":
      return {
        type: "schedule_completed",
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        sessionId: payload.sessionId!,
        status: "success",
      };
    case "schedule_failed":
      return {
        type: "schedule_failed",
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
        error: payload.error!,
      };
    case "schedule_updated":
      return {
        type: "schedule_updated",
        agentId: payload.agentId,
        scheduleId: payload.scheduleId,
      };
  }
}

export function handleScheduleWebSocket(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
) {
  fastify.get<{ Params: { projectId: string } }>(
    "/ws/projects/:projectId/schedule",
    { websocket: true },
    (socket, req) => {
      const ctx = registry.get(req.params.projectId);
      if (!ctx) {
        socket.close();
        return;
      }
      const scheduler = ctx.scheduler;

      const safeSend = (event: ScheduleServerEvent) => {
        try {
          socket.send(JSON.stringify(event));
        } catch {
          // socket already closed — ignore
        }
      };

      const handlers = new Map<(typeof EVENT_TYPES)[number], (payload: ScheduleEventPayload) => void>();
      for (const type of EVENT_TYPES) {
        const handler = (payload: ScheduleEventPayload) => safeSend(toServerEvent(type, payload));
        handlers.set(type, handler);
        scheduler.on(type, handler);
      }

      socket.on("close", () => {
        for (const [type, handler] of handlers) {
          scheduler.off(type, handler);
        }
      });
    },
  );
}
