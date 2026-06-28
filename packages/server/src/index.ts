import Fastify, { type FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { Logger } from "@spherse/core";
import { NotFoundError, ValidationError, AccessDeniedError, ConflictError } from "@spherse/core";
import { ProjectRegistry } from "./registry.js";
import { createServerLogger, createPrettyStream } from "./logger.js";
import { HttpError, errorMessage } from "./errors.js";
import { registerAllRoutes } from "./routes/index.js";
import { handleChatWebSocket } from "./ws-chat.js";
import { handleBusWebSocket } from "./ws-bus.js";

export { ProjectRegistry, type ProjectContext } from "./registry.js";

export interface MultiProjectServer {
  fastify: FastifyInstance;
  registry: ProjectRegistry;
  logger: Logger;
}

export async function createMultiProjectServer(
  options?: { defaultModel?: string; temperature?: number },
): Promise<MultiProjectServer> {
  const prettyStream = createPrettyStream();
  const logger = createServerLogger(prettyStream);

  const fastify = Fastify({ logger: { level: "debug", stream: prettyStream } });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  fastify.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    if (err instanceof NotFoundError) {
      return reply.code(404).send({ error: err.message });
    }
    if (err instanceof ValidationError) {
      return reply.code(400).send({ error: err.message });
    }
    if (err instanceof AccessDeniedError) {
      return reply.code(403).send({ error: err.message });
    }
    if (err instanceof ConflictError) {
      return reply.code(409).send({ error: err.message });
    }
    if (err instanceof Error && "validation" in err && err.validation) {
      return reply.code(400).send({ error: err.message });
    }
    req.log.error({ err }, "unhandled request error");
    reply.code(500).send({ error: errorMessage(err) });
  });

  fastify.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: "Route not found" });
  });

  const registry = new ProjectRegistry(logger, {
    defaultModel: options?.defaultModel,
    temperature: options?.temperature,
  });

  registerAllRoutes(fastify, registry);
  handleChatWebSocket(fastify, registry);
  handleBusWebSocket(fastify, registry);

  await fastify.listen({ port: 0, host: "127.0.0.1" });

  const address = fastify.server.address() as AddressInfo;
  logger.info({ port: address.port }, "server listening");

  return { fastify, registry, logger };
}
