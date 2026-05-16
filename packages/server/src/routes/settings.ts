import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";
import { SUPPORTED_PROVIDERS } from "@spherse/core";

export function registerSettingsRoutes(fastify: FastifyInstance, _ctx: AppContext): void {
  fastify.get("/api/settings/providers", async () => {
    return SUPPORTED_PROVIDERS;
  });
}
