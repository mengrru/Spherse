import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerAgentWriteRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.post<{ Body: { slug?: string; content?: string; themeContent?: string } }>(
    "/api/agents/create",
    async (req, reply) => {
      const { slug, content, themeContent } = req.body ?? {};
      if (!slug || !content)
        return reply
          .code(400)
          .send({ error: "slug and content are required" });
      if (slug.includes("..") || slug.includes("/") || slug.includes("\\"))
        return reply.code(400).send({ error: "invalid slug" });

      try {
        const profile = await ctx.engine.saveProfile(slug, content);
        if (themeContent !== undefined) {
          await ctx.engine.saveAgentTheme(profile.id, themeContent);
        }
        return { ok: true, id: profile.id };
      } catch (err: any) {
        return reply.code(500).send({ error: err.message });
      }
    },
  );

  fastify.put<{ Params: { id: string }; Body: { content?: string; themeContent?: string } }>(
    "/api/agents/:id",
    async (req, reply) => {
      const { content, themeContent } = req.body ?? {};
      if (!content)
        return reply.code(400).send({ error: "content is required" });

      const profile = await ctx.engine.getProfile(req.params.id);
      if (!profile)
        return reply.code(404).send({ error: "Agent not found" });

      try {
        const updated = await ctx.engine.saveProfile(profile.slug, content);
        if (themeContent !== undefined) {
          await ctx.engine.saveAgentTheme(req.params.id, themeContent);
        }
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
