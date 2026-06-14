import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "./registry.js";
import type { ScheduleEventPayload } from "@spherse/core";
import type { ScheduleServerEvent } from "@spherse/server/contracts";

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
      const scheduler = ctx.engine.getScheduler();

      const onScheduleTriggered = (payload: ScheduleEventPayload) => {
        const event: ScheduleServerEvent = {
          type: "schedule_triggered",
          agentId: payload.agentId,
          scheduleId: payload.scheduleId,
          sessionId: payload.sessionId,
          triggeredAt: payload.triggeredAt!,
        };
        socket.send(JSON.stringify(event));
      };

      const onScheduleCompleted = (payload: ScheduleEventPayload) => {
        const event: ScheduleServerEvent = {
          type: "schedule_completed",
          agentId: payload.agentId,
          scheduleId: payload.scheduleId,
          sessionId: payload.sessionId!,
          status: "success",
        };
        socket.send(JSON.stringify(event));
      };

      const onScheduleFailed = (payload: ScheduleEventPayload) => {
        const event: ScheduleServerEvent = {
          type: "schedule_failed",
          agentId: payload.agentId,
          scheduleId: payload.scheduleId,
          error: payload.error!,
        };
        socket.send(JSON.stringify(event));
      };

      const onScheduleUpdated = (payload: ScheduleEventPayload) => {
        const event: ScheduleServerEvent = {
          type: "schedule_updated",
          agentId: payload.agentId,
          scheduleId: payload.scheduleId,
        };
        socket.send(JSON.stringify(event));
      };

      scheduler.on("schedule_triggered", onScheduleTriggered);
      scheduler.on("schedule_completed", onScheduleCompleted);
      scheduler.on("schedule_failed", onScheduleFailed);
      scheduler.on("schedule_updated", onScheduleUpdated);

      socket.on("close", () => {
        scheduler.off("schedule_triggered", onScheduleTriggered);
        scheduler.off("schedule_completed", onScheduleCompleted);
        scheduler.off("schedule_failed", onScheduleFailed);
        scheduler.off("schedule_updated", onScheduleUpdated);
      });
    },
  );
}
