import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ProjectStore, SessionStore, AgentEngine } from "@worldbuilding-agent/core";
import { registerRoutes } from "./routes.js";
import { handleChatWebSocket } from "./ws-chat.js";

export interface AppContext {
  projectStore: ProjectStore;
  sessionStore: SessionStore;
  agentEngine: AgentEngine;
}

export async function createServer(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string },
) {
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  const projectStore = new ProjectStore(projectRoot);
  try {
    await projectStore.open();
  } catch {
    const dirName = path.basename(path.resolve(projectRoot));
    await projectStore.create(
      options?.projectName ?? dirName,
      options?.defaultModel ?? "gemini-2.5-pro",
    );
  }

  const sessionStore = new SessionStore();
  await sessionStore.init(`${projectRoot}/.pi/sessions.db`);

  const agentEngine = new AgentEngine(projectStore, sessionStore, {
    defaultModel: options?.defaultModel,
  });

  const ctx: AppContext = { projectStore, sessionStore, agentEngine };

  registerRoutes(fastify, ctx);
  handleChatWebSocket(fastify, ctx);

  await fastify.listen({ port: 0, host: "127.0.0.1" });

  return fastify;
}
