import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/contracts";
import type { AgentMemoryEntryUpdateRequest, AgentMemoryUpdateRequest } from "@spherse/contracts";
import { badRequest, notFound } from "../errors.js";

function mapMemoryError(err: unknown): Error {
  if (err instanceof Error && err.name === "ValidationError") {
    return badRequest(err.message);
  }
  if (err instanceof Error && err.name === "NotFoundError") {
    return notFound("Agent or memory entry not found");
  }
  return err instanceof Error ? err : new Error(String(err));
}

export function registerAgentMemoryRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/agents/:id/memory",
    {
      schema: { response: { 200: schemas.agentMemoryResponse } },
      async handler(req) {
        try {
          return await req.projectCtx!.runtime.getAgentMemory(req.params.id);
        } catch (err) {
          throw mapMemoryError(err);
        }
      },
    },
  );

  fastify.put<{ Params: { projectId: string; id: string }; Body: AgentMemoryUpdateRequest }>(
    "/api/projects/:projectId/agents/:id/memory",
    {
      schema: {
        body: schemas.agentMemoryUpdateRequest,
        response: { 200: schemas.agentMemoryResponse },
      },
    },
    async (req) => {
      try {
        return await req.projectCtx!.runtime.updateAgentMemory(req.params.id, req.body);
      } catch (err) {
        throw mapMemoryError(err);
      }
    },
  );

  fastify.get<{ Params: { projectId: string; id: string }; Querystring: { q?: string } }>(
    "/api/projects/:projectId/agents/:id/memory/entries",
    {
      schema: { response: { 200: schemas.agentMemoryEntriesResponse } },
      async handler(req) {
        try {
          const entries = req.projectCtx!.runtime.listAgentMemoryEntries(req.params.id, req.query?.q);
          return { entries };
        } catch (err) {
          throw mapMemoryError(err);
        }
      },
    },
  );

  fastify.put<{
    Params: { projectId: string; id: string; eid: string };
    Body: AgentMemoryEntryUpdateRequest;
  }>("/api/projects/:projectId/agents/:id/memory/entries/:eid", {
    schema: {
      body: schemas.agentMemoryEntryUpdateRequest,
      response: { 200: schemas.agentMemoryEntry },
    },
    async handler(req) {
      try {
        return req.projectCtx!.runtime.updateAgentMemoryEntry(req.params.id, req.params.eid, req.body);
      } catch (err) {
        throw mapMemoryError(err);
      }
    },
  });

  fastify.delete<{ Params: { projectId: string; id: string; eid: string } }>(
    "/api/projects/:projectId/agents/:id/memory/entries/:eid",
    {
      schema: { response: { 200: schemas.okResponse } },
      async handler(req) {
        try {
          req.projectCtx!.runtime.deleteAgentMemoryEntry(req.params.id, req.params.eid);
          return { ok: true };
        } catch (err) {
          throw mapMemoryError(err);
        }
      },
    },
  );
}
