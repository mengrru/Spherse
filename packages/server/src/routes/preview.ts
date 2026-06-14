import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { resolveProjectPath } from "@spherse/core";
import type { ProjectRegistry } from "../registry.js";

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "application/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  eot: "application/vnd.ms-fontobject",
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(CONTENT_TYPES));

export function registerPreviewRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string; "*": string } }>(
    "/api/projects/:projectId/preview/*",
    async (req, reply) => {
      const relativePath = req.params["*"];
      let absolutePath: string;
      try {
        absolutePath = resolveProjectPath(req.projectCtx!.projectStore.getRootPath(), relativePath);
      } catch {
        return reply.code(403).send({ error: "Access denied" });
      }

      const ext = path.extname(absolutePath).slice(1).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return reply.code(403).send({ error: "File type not allowed" });
      }

      try {
        const buffer = await fs.readFile(absolutePath);
        return reply.type(CONTENT_TYPES[ext]).send(buffer);
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );
}
