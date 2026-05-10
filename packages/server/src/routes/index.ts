import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";
import { registerAgentRoutes } from "./agents.js";
import { registerAgentWriteRoutes } from "./agent-write.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerContentRoutes } from "./content.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerPreviewRoutes } from "./preview.js";

export function registerAllRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  registerAgentRoutes(fastify, ctx);
  registerAgentWriteRoutes(fastify, ctx);
  registerSessionRoutes(fastify, ctx);
  registerContentRoutes(fastify, ctx);
  registerSettingsRoutes(fastify, ctx);
  registerPreviewRoutes(fastify, ctx);
}
