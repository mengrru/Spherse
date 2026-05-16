import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerAgentWriteRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.post<{ Body: { filename?: string; content?: string } }>(
    "/api/agents/create",
    async (req, reply) => {
      const { filename, content } = req.body ?? {};
      if (!filename || !content)
        return reply
          .code(400)
          .send({ error: "filename and content are required" });
      if (!filename.endsWith(".md") || filename.includes(".."))
        return reply.code(400).send({ error: "invalid filename" });

      try {
        const profile = await ctx.engine.saveProfile(filename, content);
        return { ok: true, id: profile.id };
      } catch (err: any) {
        return reply.code(500).send({ error: err.message });
      }
    },
  );

  fastify.put<{ Params: { id: string }; Body: { content?: string } }>(
    "/api/agents/:id",
    async (req, reply) => {
      const { content } = req.body ?? {};
      if (!content)
        return reply.code(400).send({ error: "content is required" });

      const profile = await ctx.engine.getProfile(req.params.id);
      if (!profile)
        return reply.code(404).send({ error: "Agent not found" });

      const filename = path.basename(profile.filePath);
      try {
        const updated = await ctx.engine.saveProfile(filename, content);
        return { ok: true, id: updated.id };
      } catch (err: any) {
        return reply.code(500).send({ error: err.message });
      }
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/agents/:id",
    async (req, reply) => {
      try {
        await ctx.engine.deleteProfile(req.params.id);
        return { ok: true };
      } catch (err: any) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );
}
