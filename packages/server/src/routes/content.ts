import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerContentRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get<{ Params: { "*": string } }>(
    "/api/content/*",
    async (req, reply) => {
      const relativePath = req.params["*"];
      const absolutePath = path.resolve(
        ctx.projectStore.getRootPath(),
        relativePath,
      );

      if (!absolutePath.startsWith(ctx.projectStore.getRootPath())) {
        return reply.code(403).send({ error: "Access denied" });
      }

      try {
        const stat = await fs.stat(absolutePath);
        if (stat.isDirectory()) {
          const entries = await fs.readdir(absolutePath, {
            withFileTypes: true,
          });
          return entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : "file",
          }));
        }
        const content = await fs.readFile(absolutePath, "utf-8");
        return { content, path: relativePath };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );
}
