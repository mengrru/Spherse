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

  fastify.post<{ Params: { "*": string }; Body: { action: "mkdir" | "touch" } }>(
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

      if (relativePath === ".spherse" || relativePath.startsWith(".spherse/") || relativePath.startsWith(".spherse\\")) {
        return reply.code(403).send({ error: "Cannot create inside .spherse directory" });
      }

      const action = req.body?.action;
      if (action !== "mkdir" && action !== "touch") {
        return reply.code(400).send({ error: "Invalid or missing 'action' (expected 'mkdir' or 'touch')" });
      }

      try {
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (stat) {
          return reply.code(409).send({ error: "Already exists" });
        }

        if (action === "mkdir") {
          await fs.mkdir(absolutePath, { recursive: true });
        } else {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.writeFile(absolutePath, "", "utf-8");
        }
        return { ok: true };
      } catch (err) {
        return reply.code(500).send({ error: `Create failed: ${(err as Error).message}` });
      }
    },
  );

  fastify.put<{ Params: { "*": string }; Body: { content: string } }>(
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

      if (typeof req.body?.content !== "string") {
        return reply.code(400).send({ error: "Missing or invalid 'content'" });
      }

      try {
        await ctx.fileWriteMutex.run(absolutePath, async () => {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.writeFile(absolutePath, req.body.content, "utf-8");
        });
        return { ok: true };
      } catch (err) {
        return reply.code(500).send({ error: `Write failed: ${(err as Error).message}` });
      }
    },
  );

  fastify.delete<{ Params: { "*": string } }>(
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

      if (relativePath === ".spherse" || relativePath.startsWith(".spherse/") || relativePath.startsWith(".spherse\\")) {
        return reply.code(403).send({ error: "Cannot delete .spherse directory" });
      }

      try {
        const stat = await fs.stat(absolutePath);
        if (stat.isDirectory()) {
          await fs.rm(absolutePath, { recursive: true });
        } else {
          await fs.unlink(absolutePath);
        }
        return { ok: true };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );
}
