import fs from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { ModelCatalog } from "@spherse/core";
import type { ModelSettingsRequest } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";
import type { ModelSettingsStore } from "../model-settings.js";
import { applyModelSettingsToEnv } from "../model-settings.js";
import { getImageSupportedProviders, resolveProjectPath } from "@spherse/core";
import { schemas } from "@spherse/contracts";

interface SettingsRouteOptions {
  modelSettingsStore: ModelSettingsStore;
  modelCatalog: ModelCatalog;
}

export function registerSettingsRoutes(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
  options?: SettingsRouteOptions,
): void {
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

  if (options) {
    fastify.get("/api/settings/models", {
      schema: { response: { 200: schemas.modelSettingsResponse } },
      async handler() {
        return options.modelSettingsStore.sanitize();
      },
    });

    fastify.put<{ Body: ModelSettingsRequest }>("/api/settings/models", {
      schema: {
        body: schemas.modelSettingsRequest,
        response: { 200: schemas.modelSettingsResponse },
      },
      async handler(req) {
        const next = options.modelSettingsStore.applyUpdate(req.body);
        applyModelSettingsToEnv(next, options.modelCatalog);
        if (next.text.defaultModel) {
          registry.setDefaultModel(next.text.defaultModel);
        }
        registry.setSampling(next.text.sampling);
        registry.setThinkingLevel(next.text.thinkingLevel);
        return options.modelSettingsStore.sanitize();
      },
    });
  }

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
    "/api/projects/:projectId/settings/side-panel",
    {
      schema: { response: { 200: schemas.sidePanelSettingsResponse } },
      async handler(req) {
        return { ok: true, ...req.projectCtx!.projectManager.getSidePanelSettings() };
      },
    },
  );

  fastify.put<{ Params: { projectId: string }; Body: { path: string | null } }>(
    "/api/projects/:projectId/settings/side-panel",
    {
      schema: {
        body: schemas.sidePanelSettingsRequest,
        response: {
          200: schemas.sidePanelSettingsResponse,
        },
      },
    },
    async (req) => {
      const settings = await req.projectCtx!.projectManager.updateSidePanelSettings(req.body.path);
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
