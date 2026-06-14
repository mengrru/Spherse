import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import { getSupportedProviders } from "@spherse/core";
import { schemas } from "@spherse/server/contracts";

export function registerSettingsRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get("/api/settings/providers", async () => {
    return getSupportedProviders();
  });

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/settings/ai-access",
    async (req) => {
      return req.projectCtx!.projectStore.getAiAccessSettings();
    },
  );

  fastify.put<{ Params: { projectId: string }; Body: { deniedPaths: string[] } }>(
    "/api/projects/:projectId/settings/ai-access",
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
        const settings = await req.projectCtx!.projectStore.updateAiAccessSettings(req.body.deniedPaths);
        return { ok: true, ...settings };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/settings/welcome-page",
    async (req) => {
      return req.projectCtx!.projectStore.getWelcomePageSettings();
    },
  );

  fastify.put<{ Params: { projectId: string }; Body: { path: string | null } }>(
    "/api/projects/:projectId/settings/welcome-page",
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
        const settings = await req.projectCtx!.projectStore.updateWelcomePageSettings(req.body.path);
        return { ok: true, ...settings };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
