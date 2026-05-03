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

export async function createServer(projectRoot: string) {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  const projectStore = new ProjectStore(projectRoot);
  await projectStore.open();

  const sessionStore = new SessionStore();
  await sessionStore.init(`${projectRoot}/.pi/sessions.db`);

  const agentEngine = new AgentEngine(projectStore, sessionStore);

  const ctx: AppContext = { projectStore, sessionStore, agentEngine };

  registerRoutes(fastify, ctx);
  handleChatWebSocket(fastify, ctx);

  return fastify;
}
