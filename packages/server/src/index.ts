import Fastify, { type FastifyInstance } from "fastify";
import pino from "pino";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { Logger } from "@spherse/core";
import { ProjectRegistry } from "./registry.js";
import { registerAllRoutes } from "./routes/index.js";
import { handleChatWebSocket } from "./ws-chat.js";
import { handleFsWatchWebSocket } from "./ws-fs-watch.js";
import { handleDebugWebSocket, createDebugStream } from "./ws-debug.js";
import { handleScheduleWebSocket } from "./ws-schedule.js";

export { ProjectRegistry, type ProjectContext } from "./registry.js";

export interface MultiProjectServer {
  fastify: FastifyInstance;
  registry: ProjectRegistry;
  logger: Logger;
}

export async function createMultiProjectServer(
  options?: { defaultModel?: string },
): Promise<MultiProjectServer> {
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

  const registry = new ProjectRegistry(logger, options?.defaultModel);

  registerAllRoutes(fastify, registry);
  handleChatWebSocket(fastify, registry);
  handleFsWatchWebSocket(fastify, registry);
  handleDebugWebSocket(fastify);
  handleScheduleWebSocket(fastify, registry);

  await fastify.listen({ port: 0, host: "127.0.0.1" });

  const address = fastify.server.address();
  logger.info({ port: (address as any).port }, "server listening");

  return { fastify, registry, logger };
}
