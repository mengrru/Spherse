import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { schemas } from "@spherse/contracts";
import { shouldSkipDirEntry } from "@spherse/core";
import type { ProjectRegistry } from "../registry.js";

/**
 * @deprecated 业务面已迁移至 /ws/rpc（content.fileTree 方法组），本 REST 路由仅为过渡保留，将随 P2 下线；新代码禁止新增依赖。
 */
export function registerFileTreeRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/file-tree",
    {
      schema: { response: { 200: schemas.fileTreeResponse } },
      async handler(req) {
        const root = req.projectCtx!.projectManager.getRootPath();
        const files: string[] = [];
        await walkDir(root, "", files);
        return files;
      },
    },
  );

  async function walkDir(absoluteDir: string, relativeDir: string, files: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (shouldSkipDirEntry(entry.name)) continue;
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walkDir(path.join(absoluteDir, entry.name), relativePath, files);
      } else {
        files.push(relativePath);
      }
    }
  }
}
