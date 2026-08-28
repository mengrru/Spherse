import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { AddressInfo } from "node:net";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import type { Logger, SamplingParams, ThinkingLevel, ModelCatalog } from "@spherse/core";
import {
  NotFoundError,
  ValidationError,
  AccessDeniedError,
  ConflictError,
} from "@spherse/core";
import { ProjectRegistry } from "./registry.js";
import { createServerLogger, createPrettyStream } from "./logger.js";
import { HttpError, errorMessage } from "./errors.js";
import { registerAuthHook, type AuthOptions } from "./auth.js";
import { registerAuthGatedCors } from "./cors.js";
import { registerAllRoutes } from "./routes/index.js";
import { setAppVersion } from "./server-info.js";
import { ChatSessionHub } from "./chat-session-hub.js";
import { handleChatWebSocket } from "./ws-chat.js";
import { handleBusWebSocket } from "./ws-bus.js";

export { ProjectRegistry, type ProjectContext, type ProjectContextCompat, type ProjectInfo, type RegisterOptions } from "./registry.js";

export const DEFAULT_SERVER_PORT = 53972;

const STATIC_ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  return new URL(withScheme).hostname.replace(/^\[|\]$/g, "");
}

function isHostAllowed(hostHeader: string | undefined, dynamicHosts: Set<string>): boolean {
  if (!hostHeader) return false;
  try {
    const hostname = normalizeHostname(hostHeader);
    return STATIC_ALLOWED_HOSTS.has(hostname) || dynamicHosts.has(hostname);
  } catch {
    return false;
  }
}

export interface MultiProjectServer {
  fastify: FastifyInstance;
  registry: ProjectRegistry;
  logger: Logger;
  addAllowedHosts: (hosts: string[]) => void;
  removeAllowedHosts: (hosts: string[]) => void;
}

export interface CreateServerOptions {
  defaultModel?: string;
  sampling?: SamplingParams;
  thinkingLevel?: ThinkingLevel;
  auth?: AuthOptions;
  port?: number;
  modelCatalog?: ModelCatalog;
  appVersion?: string;
}

export async function createMultiProjectServer(
  options?: CreateServerOptions,
): Promise<MultiProjectServer> {
  const prettyStream = createPrettyStream();
  const logger = createServerLogger(prettyStream);
  setAppVersion(options?.appVersion);

  const fastify = Fastify({
    logger: {
      level: "debug",
      stream: prettyStream,
      serializers: {
        req(req: FastifyRequest) {
          const url = req.url ?? "";
          const stripped = url.includes("?") ? `${url.split("?", 1)[0]}?<redacted>` : url;
          return {
            method: req.method,
            url: stripped,
            remotePort: req.socket?.remotePort,
          };
        },
      },
    },
    forceCloseConnections: true,
  });

  const dynamicAllowedHosts = new Set<string>();
  fastify.addHook("onRequest", async (req, reply) => {
    if (!isHostAllowed(req.headers.host, dynamicAllowedHosts)) {
      return reply.code(403).send({ error: "Forbidden host" });
    }
  });
  registerAuthGatedCors(fastify, () => options?.auth?.accessToken);

  await fastify.register(websocket);
  await fastify.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  fastify.get("/health", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } } } }, async () => ({ ok: true }));

  fastify.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send(err.body ?? { error: err.message });
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
    sampling: options?.sampling,
    thinkingLevel: options?.thinkingLevel,
    modelCatalog: options?.modelCatalog,
  });

  const chatHub = new ChatSessionHub(logger);

  registerAuthHook(fastify, options?.auth ?? {});
  registerAllRoutes(fastify, registry, {
    authRequired: Boolean(options?.auth?.accessToken),
    hub: chatHub,
  });
  handleChatWebSocket(fastify, registry, chatHub);
  handleBusWebSocket(fastify, registry);

  fastify.addHook("onResponse", async (req, reply) => {
    const urlPath = req.url.split("?", 1)[0];
    if (!urlPath.includes("/preview/")) return;
    req.log.info({ statusCode: reply.statusCode, url: urlPath.replace(/(\/__auth\/)[^/]+/g, "$1<redacted>") }, "preview response");
  });

  const preferredPort = options?.port ?? DEFAULT_SERVER_PORT;
  try {
    await fastify.listen({ port: preferredPort, host: "127.0.0.1" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== "EADDRINUSE") throw err;
    logger.warn({ port: preferredPort }, "default port in use, falling back to OS-assigned port");
    await fastify.listen({ port: 0, host: "127.0.0.1" });
  }

  const address = fastify.server.address() as AddressInfo;
  logger.info({ port: address.port }, "server listening");

  const addAllowedHosts = (hosts: string[]): void => {
    for (const host of hosts) {
      try {
        dynamicAllowedHosts.add(normalizeHostname(host));
      } catch {
        logger.warn({ host }, "ignoring invalid allowed host");
      }
    }
  };
  const removeAllowedHosts = (hosts: string[]): void => {
    for (const host of hosts) {
      try {
        dynamicAllowedHosts.delete(normalizeHostname(host));
      } catch {
        continue;
      }
    }
  };

  return { fastify, registry, logger, addAllowedHosts, removeAllowedHosts };
}
