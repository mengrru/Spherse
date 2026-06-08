import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";
import { getSupportedProviders } from "@spherse/core";
import { schemas } from "@spherse/server/contracts";

export function registerSettingsRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get("/api/settings/providers", async () => {
    return getSupportedProviders();
  });

  fastify.get("/api/settings/ai-access", async () => {
    return ctx.projectStore.getAiAccessSettings();
  });

  fastify.put<{ Body: { deniedPaths: string[] } }>(
    "/api/settings/ai-access",
    {
      schema: {
        body: schemas.aiAccessSettingsRequest,
        response: {
          200: schemas.aiAccessSettingsResponse,
          400: schemas.errorResponse,
        },
      },
    },
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

  fastify.get("/api/settings/welcome-page", async () => {
    return ctx.projectStore.getWelcomePageSettings();
  });

  fastify.put<{ Body: { path: string | null } }>(
    "/api/settings/welcome-page",
    {
      schema: {
        body: schemas.welcomePageSettingsRequest,
        response: {
          200: schemas.welcomePageSettingsResponse,
          400: schemas.errorResponse,
        },
      },
    },
    async (req, reply) => {
      if (
        !req.body ||
        !("path" in req.body) ||
        (typeof req.body.path !== "string" && req.body.path !== null)
      ) {
        return reply.code(400).send({ error: "Missing or invalid 'path'" });
      }
      try {
        const settings = await ctx.projectStore.updateWelcomePageSettings(req.body.path);
        return { ok: true, ...settings };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
