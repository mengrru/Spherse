import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { createEngine } from "@spherse/core";
import type { ProjectStore } from "@spherse/core";
import type { Engine } from "@spherse/core";
import type { FileWriteMutex } from "@spherse/core";
import { registerAllRoutes } from "./routes/index.js";
import { handleChatWebSocket } from "./ws-chat.js";
import { handleFsWatchWebSocket } from "./ws-fs-watch.js";

export interface AppContext {
  engine: Engine;
  projectStore: ProjectStore;
  fileWriteMutex: FileWriteMutex;
}

export async function createServer(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string },
) {
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  const { engine, projectStore } = await createEngine(projectRoot, options);

  const ctx: AppContext = { engine, projectStore, fileWriteMutex: engine.getFileWriteMutex() };

  registerAllRoutes(fastify, ctx);
  handleChatWebSocket(fastify, ctx);
  handleFsWatchWebSocket(fastify, ctx);

  await fastify.listen({ port: 0, host: "127.0.0.1" });

  return fastify;
}
