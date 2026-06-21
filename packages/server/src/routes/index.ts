import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ProjectRegistry, ProjectContext } from "../registry.js";
import { notFound } from "../errors.js";
import { registerAgentRoutes } from "./agents.js";
import { registerAgentWriteRoutes } from "./agent-write.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerContentRoutes } from "./content.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerPreviewRoutes } from "./preview.js";
import { registerSkillRoutes } from "./skills.js";
import { registerFileTreeRoutes } from "./file-tree.js";
import { registerDebugRoutes } from "./debug.js";
import { registerScheduleRoutes } from "./schedules.js";
import { registerImagesRoutes } from "./images.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: ProjectContext;
  }
}

export function registerAllRoutes(fastify: FastifyInstance, registry: ProjectRegistry): void {
  fastify.addHook("preHandler", async (req: FastifyRequest) => {
    const projectId = (req.params as Record<string, string> | undefined)?.projectId;
    if (projectId === undefined) return;
    const ctx = registry.get(projectId);
    if (!ctx) throw notFound("Unknown project");
    req.projectCtx = ctx;
  });

  registerAgentRoutes(fastify, registry);
  registerAgentWriteRoutes(fastify, registry);
  registerSessionRoutes(fastify, registry);
  registerContentRoutes(fastify, registry);
  registerSettingsRoutes(fastify, registry);
  registerPreviewRoutes(fastify, registry);
  registerSkillRoutes(fastify, registry);
  registerFileTreeRoutes(fastify, registry);
  registerDebugRoutes(fastify, registry);
  registerScheduleRoutes(fastify, registry);
  registerImagesRoutes(fastify, registry);
}
