import fs from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import { getImageSupportedProviders, resolveProjectPath } from "@spherse/core";
import { schemas } from "@spherse/contracts";

export function registerSettingsRoutes(fastify: FastifyInstance, registry: ProjectRegistry): void {
  fastify.get("/api/settings/providers", {
    schema: { response: { 200: schemas.providerCatalog } },
    async handler() {
      return registry.getSupportedProviders();
    },
  });

  fastify.get("/api/settings/image-providers", {
    schema: { response: { 200: schemas.providerCatalog } },
    async handler() {
      return getImageSupportedProviders();
    },
  });

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/settings/ai-access",
    {
      schema: { response: { 200: schemas.aiAccessSettingsResponse } },
      async handler(req) {
        return { ok: true, ...req.projectCtx!.projectManager.getAiAccessSettings() };
      },
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
    {
      schema: { response: { 200: schemas.welcomePageSettingsResponse } },
      async handler(req) {
        return { ok: true, ...req.projectCtx!.projectManager.getWelcomePageSettings() };
      },
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

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/settings/theme",
    {
      schema: { response: { 200: schemas.themeSettingsResponse } },
      async handler(req) {
        const root = req.projectCtx!.projectManager.getRootPath();
        const absolutePath = resolveProjectPath(root, ".spherse/theme.css");
        let content = "";
        try {
          content = await fs.readFile(absolutePath, "utf-8");
        } catch {
          content = "";
        }
        return { ok: true, content };
      },
    },
  );

  fastify.put<{ Params: { projectId: string }; Body: { content: string } }>(
    "/api/projects/:projectId/settings/theme",
    {
      schema: {
        body: schemas.themeSettingsRequest,
        response: { 200: schemas.okResponse },
      },
    },
    async (req) => {
      await req.projectCtx!.projectManager.writeFile(".spherse/theme.css", req.body.content);
      return { ok: true };
    },
  );
}
