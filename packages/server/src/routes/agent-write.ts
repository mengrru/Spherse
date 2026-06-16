import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import { badRequest } from "../errors.js";

export function registerAgentWriteRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.post<{ Params: { projectId: string }; Body: { slug?: string; content?: string; themeContent?: string } }>(
    "/api/projects/:projectId/agents/create",
    async (req) => {
      const { slug, content } = req.body ?? {};
      if (!slug || !content) throw badRequest("slug and content are required");

      const profile = await req.projectCtx!.projectManager.createAgent(slug, content, req.body?.themeContent);
      return { ok: true, id: profile.id };
    },
  );

  fastify.put<{ Params: { projectId: string; id: string }; Body: { content?: string; themeContent?: string } }>(
    "/api/projects/:projectId/agents/:id",
    async (req) => {
      const { content } = req.body ?? {};
      if (!content) throw badRequest("content is required");

      const updated = await req.projectCtx!.projectManager.updateAgent(req.params.id, content, req.body?.themeContent);
      return { ok: true, id: updated.id };
    },
  );

  fastify.delete<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/agents/:id",
    async (req) => {
      await req.projectCtx!.runtime.deleteAgent(req.params.id);
      return { ok: true };
    },
  );
}
