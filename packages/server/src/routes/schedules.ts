import type { FastifyInstance } from "fastify";
import { CronExpressionParser } from "cron-parser";
import { schemas, parseContract } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";

function validateCron(cron: string): true | string {
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch (err: any) {
    return err.message ?? "invalid cron expression";
  }
}

export function registerScheduleRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; agentId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules",
    async (req) => {
      const scheduler = req.projectCtx!.engine.getScheduler();
      const entries = scheduler.list(req.params.agentId);
      return entries.map((entry) => ({
        ...entry,
        nextTriggerAt: scheduler.getNextTrigger(req.params.agentId, entry.id)?.getTime() ?? null,
      }));
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string; scheduleId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules/:scheduleId",
    async (req, reply) => {
      const entry = req.projectCtx!.engine.getScheduler().get(req.params.agentId, req.params.scheduleId);
      if (!entry) return reply.code(404).send({ error: "Schedule not found" });
      return entry;
    },
  );

  fastify.post<{ Params: { projectId: string; agentId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules",
    { schema: { body: schemas.createScheduleRequest } },
    async (req, reply) => {
      try {
        const data = parseContract(schemas.createScheduleRequest, req.body);
        const cronErr = validateCron(data.cron);
        if (cronErr !== true) return reply.code(400).send({ error: `invalid cron: ${cronErr}` });
        if (data.mode === "existing_session" && !data.targetSessionId) {
          return reply.code(400).send({ error: "targetSessionId is required for existing_session mode" });
        }
        const scheduler = req.projectCtx!.engine.getScheduler();
        const now = Date.now();
        const entry = {
          id: crypto.randomUUID(),
          name: data.name,
          enabled: true,
          cron: data.cron,
          mode: data.mode,
          targetSessionId: data.targetSessionId,
          message: data.message,
          notify: data.notify,
          notificationMessage: data.notify ? data.notificationMessage : undefined,
          createdAt: now,
          updatedAt: now,
        };
        scheduler.register(req.params.agentId, entry);
        return reply.code(201).send(entry);
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.put<{ Params: { projectId: string; agentId: string; scheduleId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules/:scheduleId",
    { schema: { body: schemas.updateScheduleRequest } },
    async (req, reply) => {
      try {
        const data = parseContract(schemas.updateScheduleRequest, req.body);
        if (data.cron) {
          const cronErr = validateCron(data.cron);
          if (cronErr !== true) return reply.code(400).send({ error: `invalid cron: ${cronErr}` });
        }
        const existing = req.projectCtx!.engine.getScheduler().get(req.params.agentId, req.params.scheduleId);
        if (!existing) return reply.code(404).send({ error: "Schedule not found" });
        const resolvedMode = data.mode ?? existing.mode;
        const resolvedTarget = data.targetSessionId !== undefined ? data.targetSessionId : existing.targetSessionId;
        if (resolvedMode === "existing_session" && !resolvedTarget) {
          return reply.code(400).send({ error: "targetSessionId is required for existing_session mode" });
        }
        const updated = req.projectCtx!.engine.getScheduler().update(req.params.agentId, req.params.scheduleId, data);
        return updated;
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.delete<{ Params: { projectId: string; agentId: string; scheduleId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules/:scheduleId",
    async (req) => {
      req.projectCtx!.engine.getScheduler().unregister(req.params.agentId, req.params.scheduleId);
      return { ok: true };
    },
  );

  fastify.post<{ Params: { projectId: string; agentId: string; scheduleId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules/:scheduleId/trigger",
    async (req, reply) => {
      try {
        const scheduler = req.projectCtx!.engine.getScheduler();
        const entry = scheduler.get(req.params.agentId, req.params.scheduleId);
        if (!entry) return reply.code(404).send({ error: "Schedule not found" });
        scheduler.triggerNow(req.params.agentId, req.params.scheduleId);
        return { ok: true };
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string }; Querystring: { limit?: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedule-logs",
    async (req) => {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      return req.projectCtx!.engine.getScheduler().getRecentLogs(req.params.agentId, limit);
    },
  );
}
