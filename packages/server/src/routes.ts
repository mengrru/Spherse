import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./index.js";

export function registerRoutes(fastify: FastifyInstance, ctx: AppContext) {
  fastify.get("/api/agents", async () => {
    return ctx.agentEngine.listAgents();
  });

  fastify.get<{ Params: { name: string } }>(
    "/api/agents/:name",
    async (req, reply) => {
      const agents = await ctx.agentEngine.listAgents();
      const agent = agents.find((a) => a.name === req.params.name);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      return agent;
    },
  );

  fastify.post<{ Body: { agentName?: string } }>(
    "/api/sessions",
    async (req, reply) => {
      const { agentName } = req.body ?? {};
      if (!agentName)
        return reply.code(400).send({ error: "agentName is required" });
      try {
        const sessionId = await ctx.agentEngine.createSession(agentName);
        return { sessionId };
      } catch (err: any) {
        return reply.code(404).send({ error: err.message });
      }
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (req, reply) => {
      const session = ctx.sessionStore.getSession(req.params.id);
      if (!session)
        return reply.code(404).send({ error: "Session not found" });
      return session;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/:id/messages",
    async (req) => {
      return ctx.agentEngine.getSessionHistory(req.params.id);
    },
  );

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
