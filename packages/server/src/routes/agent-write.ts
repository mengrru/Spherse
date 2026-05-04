import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";

export function registerAgentWriteRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.post<{ Body: { filename?: string; content?: string } }>(
    "/api/agents/create",
    async (req, reply) => {
      const { filename, content } = req.body ?? {};
      if (!filename || !content)
        return reply
          .code(400)
          .send({ error: "filename and content are required" });
      if (!filename.endsWith(".md") || filename.includes(".."))
        return reply.code(400).send({ error: "invalid filename" });

      const config = ctx.projectStore.getConfig();
      if (!config)
        return reply.code(500).send({ error: "Project not initialized" });

      const agentDir = path.join(
        ctx.projectStore.getRootPath(),
        ".pi",
        config.paths.agents,
      );
      const filePath = path.join(agentDir, filename);
      if (!filePath.startsWith(agentDir))
        return reply.code(403).send({ error: "Access denied" });

      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return { ok: true };
    },
  );
}
