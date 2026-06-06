import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";
import { getSupportedProviders } from "@spherse/core";

export function registerSettingsRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get("/api/settings/providers", async () => {
    return getSupportedProviders();
  });

  fastify.get("/api/settings/ai-access", async () => {
    return ctx.projectStore.getAiAccessSettings();
  });

  fastify.put<{ Body: { deniedPaths: string[] } }>(
    "/api/settings/ai-access",
    async (req, reply) => {
      if (!Array.isArray(req.body?.deniedPaths)) {
        return reply.code(400).send({ error: "Missing or invalid 'deniedPaths'" });
      }
      try {
        const settings = await ctx.projectStore.updateAiAccessSettings(req.body.deniedPaths);
        return { ok: true, ...settings };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
