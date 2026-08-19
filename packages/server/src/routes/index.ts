import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ProjectRegistry, ProjectContextCompat } from "../registry.js";
import type { ChatSessionHub } from "../chat-session-hub.js";
import { notFound } from "../errors.js";
import { registerAgentRoutes } from "./agents.js";
import { registerAgentWriteRoutes } from "./agent-write.js";
import { registerAgentMcpRoutes } from "./agent-mcp.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerContentRoutes } from "./content.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerPreviewRoutes } from "./preview.js";
import { registerSkillRoutes } from "./skills.js";
import { registerFileTreeRoutes } from "./file-tree.js";
import { registerDebugRoutes } from "./debug.js";
import { registerTriggerRoutes } from "./trigger.js";
import { registerImagesRoutes } from "./images.js";
import { registerAttachmentsRoutes } from "./attachments.js";
import { registerConnectionRoutes } from "./connection.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: ProjectContextCompat;
  }
}

export interface RouteOptions {
  authRequired?: boolean;
  hub: ChatSessionHub;
}

export function registerAllRoutes(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
  options: RouteOptions,
): void {
  fastify.addHook("preHandler", async (req: FastifyRequest) => {
    const projectId = (req.params as Record<string, string> | undefined)?.projectId;
    if (projectId === undefined) return;
    const ctx = registry.get(projectId);
    if (!ctx) throw notFound("Unknown project");
    req.projectCtx = ctx;
  });

  registerConnectionRoutes(fastify, registry, { authRequired: options?.authRequired ?? false });
  registerAgentRoutes(fastify, registry);
  registerAgentWriteRoutes(fastify, registry);
  registerAgentMcpRoutes(fastify, registry);
  registerSessionRoutes(fastify, registry, options.hub);
  registerContentRoutes(fastify, registry);
  registerSettingsRoutes(fastify, registry);
  registerPreviewRoutes(fastify, registry);
  registerSkillRoutes(fastify, registry);
  registerFileTreeRoutes(fastify, registry);
  registerDebugRoutes(fastify, registry);
  registerTriggerRoutes(fastify, registry);
  registerImagesRoutes(fastify, registry);
  registerAttachmentsRoutes(fastify, registry);
}
