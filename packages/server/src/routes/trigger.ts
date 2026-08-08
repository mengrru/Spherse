import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { isValidCron, isReservedEventName, requiresTargetSession } from "@spherse/core";
import { schemas } from "@spherse/server/contracts";
import type { TriggerCreateRequest, TriggerUpdateRequest } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";
import { badRequest, notFound } from "../errors.js";

function isValidTriggerMode(mode: string, targetSessionId: string | undefined): boolean {
  return !requiresTargetSession(mode, targetSessionId);
}

export function registerTriggerRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; agentId: string } }>(
    "/api/projects/:projectId/agents/:agentId/triggers",
    {
      schema: { response: { 200: schemas.triggerListResponse } },
      async handler(req) {
        const triggerManager = req.projectCtx!.triggerManager;
        const entries = triggerManager.list(req.params.agentId);
        return entries.map((entry) => ({
          ...entry,
          nextTriggerAt: triggerManager.getNextTrigger(req.params.agentId, entry.id)?.getTime() ?? null,
        }));
      },
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string; triggerId: string } }>(
    "/api/projects/:projectId/agents/:agentId/triggers/:triggerId",
    {
      schema: { response: { 200: schemas.triggerEntry } },
      async handler(req) {
        const entry = req.projectCtx!.triggerManager.get(req.params.agentId, req.params.triggerId);
        if (!entry) throw notFound("Trigger not found");
        return entry;
      },
    },
  );

  fastify.post<{ Params: { projectId: string; agentId: string }; Body: TriggerCreateRequest }>(
    "/api/projects/:projectId/agents/:agentId/triggers",
    {
      schema: {
        body: schemas.triggerCreateRequest,
        response: { 201: schemas.triggerEntry },
      },
    },
    async (req, reply) => {
      const data = req.body;

      if (data.type === "time") {
        if (!data.cron || !isValidCron(data.cron)) throw badRequest("invalid cron expression");
      } else if (data.type === "event") {
        if (!data.eventName?.trim()) throw badRequest("eventName is required for event type");
        if (isReservedEventName(data.eventName)) throw badRequest("eventName cannot use reserved prefix 'sp:'");
      }

      if (!isValidTriggerMode(data.mode, data.targetSessionId)) {
        throw badRequest("targetSessionId is required for existing_session mode");
      }

      const triggerManager = req.projectCtx!.triggerManager;
      const now = Date.now();
      const entry = {
        id: nanoid(),
        name: data.name,
        enabled: true,
        type: data.type,
        cron: data.type === "time" ? data.cron : undefined,
        eventName: data.type === "event" ? data.eventName : undefined,
        mode: data.mode,
        targetSessionId: data.targetSessionId,
        message: data.message,
        notify: data.notify,
        notificationMessage: data.notify ? data.notificationMessage : undefined,
        createdAt: now,
        updatedAt: now,
      };
      triggerManager.create(req.params.agentId, entry);
      return reply.code(201).send(entry);
    },
  );

  fastify.put<{ Params: { projectId: string; agentId: string; triggerId: string }; Body: TriggerUpdateRequest }>(
    "/api/projects/:projectId/agents/:agentId/triggers/:triggerId",
    {
      schema: {
        body: schemas.triggerUpdateRequest,
        response: { 200: schemas.triggerEntry },
      },
    },
    async (req) => {
      const data = req.body;

      if (data.cron !== undefined && !isValidCron(data.cron)) throw badRequest("invalid cron expression");
      if (data.eventName !== undefined && isReservedEventName(data.eventName)) {
        throw badRequest("eventName cannot use reserved prefix 'sp:'");
      }

      const existing = req.projectCtx!.triggerManager.get(req.params.agentId, req.params.triggerId);
      if (!existing) throw notFound("Trigger not found");

      const resolvedMode = data.mode ?? existing.mode;
      const resolvedTarget = data.targetSessionId !== undefined ? data.targetSessionId : existing.targetSessionId;
      if (!isValidTriggerMode(resolvedMode, resolvedTarget)) {
        throw badRequest("targetSessionId is required for existing_session mode");
      }

      return req.projectCtx!.triggerManager.update(req.params.agentId, req.params.triggerId, data);
    },
  );

  fastify.delete<{ Params: { projectId: string; agentId: string; triggerId: string } }>(
    "/api/projects/:projectId/agents/:agentId/triggers/:triggerId",
    { schema: { response: { 200: schemas.okResponse } } },
    async (req) => {
      req.projectCtx!.triggerManager.delete(req.params.agentId, req.params.triggerId);
      return { ok: true };
    },
  );

  fastify.post<{ Params: { projectId: string; agentId: string; triggerId: string } }>(
    "/api/projects/:projectId/agents/:agentId/triggers/:triggerId/run",
    { schema: { response: { 200: schemas.okResponse } } },
    async (req) => {
      const triggerManager = req.projectCtx!.triggerManager;
      const entry = triggerManager.get(req.params.agentId, req.params.triggerId);
      if (!entry) throw notFound("Trigger not found");
      triggerManager.runNow(req.params.agentId, req.params.triggerId);
      return { ok: true };
    },
  );

  fastify.post<{ Params: { projectId: string; agentId: string; triggerId: string } }>(
    "/api/projects/:projectId/agents/:agentId/triggers/:triggerId/reset-binding",
    { schema: { response: { 200: schemas.triggerEntry } } },
    async (req) => {
      const triggerManager = req.projectCtx!.triggerManager;
      const entry = triggerManager.get(req.params.agentId, req.params.triggerId);
      if (!entry) throw notFound("Trigger not found");
      if (entry.mode !== "reusable_session") {
        throw badRequest("reset-binding only applies to reusable_session triggers");
      }
      const updated = triggerManager.update(req.params.agentId, req.params.triggerId, {
        boundSessionId: undefined,
      });
      if (!updated) throw notFound("Trigger not found");
      return updated;
    },
  );

  fastify.get<{ Params: { projectId: string; agentId: string }; Querystring: { limit?: string } }>(
    "/api/projects/:projectId/agents/:agentId/trigger-logs",
    {
      schema: { response: { 200: schemas.triggerLogListResponse } },
      async handler(req) {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
        return req.projectCtx!.triggerManager.getRecentLogs(req.params.agentId, limit);
      },
    },
  );
}
