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
      return req.projectCtx!.projectManager.getAiAccessSettings();
    },
  );

  fastify.put<{ Params: { projectId: string }; Body: { deniedPaths: string[] } }>(
    "/api/projects/:projectId/settings/ai-access",
    {
      schema: {
        body: schemas.aiAccessSettingsRequest,
        response: {
          200: schemas.aiAccessSettingsResponse,
        },
      },
    },
    async (req) => {
      const settings = await req.projectCtx!.projectManager.updateAiAccessSettings(req.body.deniedPaths);
      return { ok: true, ...settings };
    },
  );

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/settings/welcome-page",
    async (req) => {
      return req.projectCtx!.projectManager.getWelcomePageSettings();
    },
  );

  fastify.put<{ Params: { projectId: string }; Body: { path: string | null } }>(
    "/api/projects/:projectId/settings/welcome-page",
    {
      schema: {
        body: schemas.welcomePageSettingsRequest,
        response: {
          200: schemas.welcomePageSettingsResponse,
        },
      },
    },
    async (req) => {
      const settings = await req.projectCtx!.projectManager.updateWelcomePageSettings(req.body.path);
      return { ok: true, ...settings };
    },
  );
}
