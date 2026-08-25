import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/server/contracts";
import type { ProjectRegistry } from "../registry.js";
import { notFound } from "../errors.js";
import { getAppVersion } from "../server-info.js";

const SERVER_VERSION = "0.1.0";
const API_VERSION = "1";

export interface ConnectionRouteOptions {
  authRequired: boolean;
}

export function registerConnectionRoutes(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
  options: ConnectionRouteOptions,
): void {
  fastify.get("/api/connection/info", {
    schema: { response: { 200: schemas.connectionInfoResponse } },
    async handler() {
      return {
        serverVersion: SERVER_VERSION,
        authRequired: options.authRequired,
        apiVersion: API_VERSION,
        appVersion: getAppVersion() ?? null,
      };
    },
  });

  fastify.get("/api/projects", {
    schema: { response: { 200: schemas.projectListResponse } },
    async handler() {
      return registry.listInfo().map(({ id, name, lastOpened }) => ({ id, name, lastOpened }));
    },
  });

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/info",
    {
      schema: { response: { 200: schemas.projectInfoResponse } },
      async handler(req) {
        const info = registry.getInfo(req.params.projectId);
        if (!info) throw notFound("Unknown project");
        const { id, name, rootPath, lastOpened } = info;
        return { id, name, rootPath, lastOpened };
      },
    },
  );
}
