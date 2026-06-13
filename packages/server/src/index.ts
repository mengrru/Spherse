import Fastify from "fastify";
import pino from "pino";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { createEngine } from "@spherse/core";
import type { ProjectStore } from "@spherse/core";
import type { Engine } from "@spherse/core";
import type { FileWriteMutex } from "@spherse/core";
import { registerAllRoutes } from "./routes/index.js";
import { handleChatWebSocket } from "./ws-chat.js";
import { handleFsWatchWebSocket } from "./ws-fs-watch.js";
import { handleDebugWebSocket, createDebugStream } from "./ws-debug.js";
import { handleScheduleWebSocket } from "./ws-schedule.js";

export interface AppContext {
  engine: Engine;
  projectStore: ProjectStore;
  fileWriteMutex: FileWriteMutex;
}

export async function createServer(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string },
) {
  const pretty = pino.transport({
    target: "pino-pretty",
    options: { colorize: true },
  });
  pretty.on("error", () => {});

  const debugStream = createDebugStream();
  const logger = pino({ level: "debug" }, pino.multistream([pretty, debugStream]));

  const fastifyTransport = pino.transport({
    target: "pino-pretty",
    options: { colorize: true },
  });
  fastifyTransport.on("error", () => {});

  const fastify = Fastify({
    logger: { level: "debug", stream: fastifyTransport },
  });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  const { engine, projectStore } = await createEngine(projectRoot, {
    ...options,
    logger,
  });

  const ctx: AppContext = { engine, projectStore, fileWriteMutex: engine.getFileWriteMutex() };

  registerAllRoutes(fastify, ctx);
  handleChatWebSocket(fastify, ctx);
  handleFsWatchWebSocket(fastify, ctx);
  handleDebugWebSocket(fastify);
  handleScheduleWebSocket(fastify, ctx);

  await fastify.listen({ port: 0, host: "127.0.0.1" });

  const address = fastify.server.address();
  logger.info({ port: (address as any).port }, "server listening");

  return { fastify, engine };
}
