import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { Stats } from "node:fs";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  resolveProjectPath,
  serverAccessPolicy,
  AccessDeniedError,
} from "@spherse/core";
import type { ProjectRegistry } from "../registry.js";
import { forbidden, notFound } from "../errors.js";

const BLOCKED_SEGMENTS = new Set([".git", "node_modules"]);

function hasBlockedSegment(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => BLOCKED_SEGMENTS.has(segment));
}

function contentDispositionFilename(basename: string): string {
  const fallback = basename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(basename)}`;
}

async function handleDownload(req: FastifyRequest<{ Params: { "*": string } }>, reply: FastifyReply): Promise<unknown> {
  const relativePath = req.params["*"];
  const pm = req.projectCtx!.projectManager;
  const root = pm.getRootPath();

  const policy = serverAccessPolicy(root);
  try {
    policy.assertRead(relativePath);
    if (hasBlockedSegment(relativePath)) throw new AccessDeniedError("Access denied");
  } catch (err) {
    if (err instanceof AccessDeniedError) throw forbidden("Access denied");
    throw err;
  }
  const absolutePath = resolveProjectPath(root, relativePath);

  let stat: Stats;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    throw notFound("Not found");
  }
  if (stat.isDirectory()) throw notFound("Not found");

  const basename = path.basename(absolutePath);
  return reply
    .type("application/octet-stream")
    .header("Content-Disposition", contentDispositionFilename(basename))
    .header("Content-Length", stat.size)
    .send(createReadStream(absolutePath));
}

export function registerDownloadRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { "*": string } }>(
    "/api/projects/:projectId/download/*",
    async (req, reply) => handleDownload(req, reply),
  );
}
