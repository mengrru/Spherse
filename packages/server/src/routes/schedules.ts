import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { CronExpressionParser } from "cron-parser";
import { schemas } from "@spherse/server/contracts";
import type { ScheduleCreateRequest, ScheduleUpdateRequest } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";
import { badRequest, notFound } from "../errors.js";

function isValidCron(cron: string): boolean {
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}

function isValidScheduleMode(mode: string, targetSessionId: string | undefined): boolean {
  return mode !== "existing_session" || !!targetSessionId;
}

export function registerScheduleRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; agentId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules",
    {
      schema: { response: { 200: schemas.scheduleListResponse } },
      async handler(req) {
        const scheduler = req.projectCtx!.scheduler;
        const entries = scheduler.list(req.params.agentId);
        return entries.map((entry) => ({
          ...entry,
          nextTriggerAt: scheduler.getNextTrigger(req.params.agentId, entry.id)?.getTime() ?? null,
        }));
      },
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string; scheduleId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules/:scheduleId",
    {
      schema: { response: { 200: schemas.scheduleEntry } },
      async handler(req) {
        const entry = req.projectCtx!.scheduler.get(req.params.agentId, req.params.scheduleId);
        if (!entry) throw notFound("Schedule not found");
        return entry;
      },
    },
  );

  fastify.post<{ Params: { projectId: string; agentId: string }; Body: ScheduleCreateRequest }>(
    "/api/projects/:projectId/agents/:agentId/schedules",
    {
      schema: {
        body: schemas.scheduleCreateRequest,
        response: { 201: schemas.scheduleEntry },
      },
    },
    async (req, reply) => {
      const data = req.body;
      if (!isValidCron(data.cron)) throw badRequest("invalid cron expression");
      if (!isValidScheduleMode(data.mode, data.targetSessionId)) {
        throw badRequest("targetSessionId is required for existing_session mode");
      }

      const scheduler = req.projectCtx!.scheduler;
      const now = Date.now();
      const entry = {
        id: nanoid(),
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
    },
  );

  fastify.put<{ Params: { projectId: string; agentId: string; scheduleId: string }; Body: ScheduleUpdateRequest }>(
    "/api/projects/:projectId/agents/:agentId/schedules/:scheduleId",
    {
      schema: {
        body: schemas.scheduleUpdateRequest,
        response: { 200: schemas.scheduleEntry },
      },
    },
    async (req) => {
      const data = req.body;
      if (data.cron && !isValidCron(data.cron)) throw badRequest("invalid cron expression");

      const existing = req.projectCtx!.scheduler.get(req.params.agentId, req.params.scheduleId);
      if (!existing) throw notFound("Schedule not found");

      const resolvedMode = data.mode ?? existing.mode;
      const resolvedTarget = data.targetSessionId !== undefined ? data.targetSessionId : existing.targetSessionId;
      if (!isValidScheduleMode(resolvedMode, resolvedTarget)) {
        throw badRequest("targetSessionId is required for existing_session mode");
      }

      return req.projectCtx!.scheduler.update(req.params.agentId, req.params.scheduleId, data);
    },
  );

  fastify.delete<{ Params: { projectId: string; agentId: string; scheduleId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules/:scheduleId",
    { schema: { response: { 200: schemas.okResponse } } },
    async (req) => {
      req.projectCtx!.scheduler.unregister(req.params.agentId, req.params.scheduleId);
      return { ok: true };
    },
  );

  fastify.post<{ Params: { projectId: string; agentId: string; scheduleId: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedules/:scheduleId/trigger",
    { schema: { response: { 200: schemas.okResponse } } },
    async (req) => {
      const scheduler = req.projectCtx!.scheduler;
      const entry = scheduler.get(req.params.agentId, req.params.scheduleId);
      if (!entry) throw notFound("Schedule not found");
      scheduler.triggerNow(req.params.agentId, req.params.scheduleId);
      return { ok: true };
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string }; Querystring: { limit?: string } }>(
    "/api/projects/:projectId/agents/:agentId/schedule-logs",
    {
      schema: { response: { 200: schemas.scheduleLogListResponse } },
      async handler(req) {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
        return req.projectCtx!.scheduler.getRecentLogs(req.params.agentId, limit);
      },
    },
  );
}
