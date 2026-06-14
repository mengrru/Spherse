import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";

const EXCLUDED_DIRS = new Set([".spherse", "node_modules", ".git"]);

export function registerFileTreeRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/file-tree",
    async (req) => {
      const root = req.projectCtx!.projectStore.getRootPath();
      const files: string[] = [];
      await walkDir(root, "", files);
      return files;
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
      if (entry.name.startsWith(".")) continue;
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walkDir(path.join(absoluteDir, entry.name), relativePath, files);
      } else {
        files.push(relativePath);
      }
    }
  }
}
