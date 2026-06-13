import type { FastifyInstance } from "fastify";
import { CronExpressionParser } from "cron-parser";
import { schemas, parseContract } from "@spherse/server/contracts";
import type { AppContext } from "../index.js";

function validateCron(cron: string): true | string {
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch (err: any) {
    return err.message ?? "invalid cron expression";
  }
}

export function registerScheduleRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  const getScheduler = () => ctx.engine.getScheduler();

  fastify.get<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/schedules",
    async (req) => {
      const scheduler = getScheduler();
      const entries = scheduler.list(req.params.agentId);
      return entries.map((entry) => ({
        ...entry,
        nextTriggerAt: scheduler.getNextTrigger(req.params.agentId, entry.id)?.getTime() ?? null,
      }));
    },
  );

  fastify.get<{ Params: { agentId: string; scheduleId: string } }>(
    "/api/agents/:agentId/schedules/:scheduleId",
    async (req, reply) => {
      const entry = getScheduler().get(req.params.agentId, req.params.scheduleId);
      if (!entry) return reply.code(404).send({ error: "Schedule not found" });
      return entry;
    },
  );

  fastify.post<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/schedules",
    { schema: { body: schemas.createScheduleRequest } },
    async (req, reply) => {
      try {
        const data = parseContract(schemas.createScheduleRequest, req.body);
        const cronErr = validateCron(data.cron);
        if (cronErr !== true) return reply.code(400).send({ error: `invalid cron: ${cronErr}` });
        if (data.mode === "existing_session" && !data.targetSessionId) {
          return reply.code(400).send({ error: "targetSessionId is required for existing_session mode" });
        }
        const scheduler = getScheduler();
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

  fastify.put<{ Params: { agentId: string; scheduleId: string } }>(
    "/api/agents/:agentId/schedules/:scheduleId",
    { schema: { body: schemas.updateScheduleRequest } },
    async (req, reply) => {
      try {
        const data = parseContract(schemas.updateScheduleRequest, req.body);
        if (data.cron) {
          const cronErr = validateCron(data.cron);
          if (cronErr !== true) return reply.code(400).send({ error: `invalid cron: ${cronErr}` });
        }
        const existing = getScheduler().get(req.params.agentId, req.params.scheduleId);
        if (!existing) return reply.code(404).send({ error: "Schedule not found" });
        const resolvedMode = data.mode ?? existing.mode;
        const resolvedTarget = data.targetSessionId !== undefined ? data.targetSessionId : existing.targetSessionId;
        if (resolvedMode === "existing_session" && !resolvedTarget) {
          return reply.code(400).send({ error: "targetSessionId is required for existing_session mode" });
        }
        const updated = getScheduler().update(req.params.agentId, req.params.scheduleId, data);
        return updated;
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.delete<{ Params: { agentId: string; scheduleId: string } }>(
    "/api/agents/:agentId/schedules/:scheduleId",
    async (req) => {
      getScheduler().unregister(req.params.agentId, req.params.scheduleId);
      return { ok: true };
    },
  );

  fastify.post<{ Params: { agentId: string; scheduleId: string } }>(
    "/api/agents/:agentId/schedules/:scheduleId/trigger",
    async (_req, reply) => {
      try {
        const scheduler = getScheduler();
        const entry = scheduler.get(_req.params.agentId, _req.params.scheduleId);
        if (!entry) return reply.code(404).send({ error: "Schedule not found" });
        scheduler.triggerNow(_req.params.agentId, _req.params.scheduleId);
        return { ok: true };
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  fastify.get<{ Params: { agentId: string }; Querystring: { limit?: string } }>(
    "/api/agents/:agentId/schedule-logs",
    async (req) => {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      return getScheduler().getRecentLogs(req.params.agentId, limit);
    },
  );
}
