import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";

const PUBLIC_PATHS = new Set(["/health", "/api/connection/info"]);

const PREVIEW_AUTH_PREFIX = "/__auth/";

export interface AuthOptions {
  accessToken?: string;
}

function extractBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function extractQueryToken(req: FastifyRequest): string | null {
  const raw = (req.query as Record<string, unknown> | undefined)?.token;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function extractPreviewPathToken(req: FastifyRequest): string | null {
  const url = req.url.split("?", 1)[0];
  const marker = `/preview${PREVIEW_AUTH_PREFIX}`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const tail = url.slice(idx + marker.length);
  const end = tail.indexOf("/");
  if (end === -1) return null;
  return tail.slice(0, end);
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function verifyPresentedToken(req: FastifyRequest, token: string): boolean {
  const isWsRoute = req.url.startsWith("/ws/");
  const presented = isWsRoute
    ? extractQueryToken(req)
    : (extractBearerToken(req) ?? extractQueryToken(req) ?? extractPreviewPathToken(req));
  if (!presented) return false;
  return safeEqual(presented, token);
}

export function registerAuthHook(
  fastify: FastifyInstance,
  options: AuthOptions,
): void {
  const token = options.accessToken;
  if (!token) return;

  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const urlPath = req.url.split("?", 1)[0];
    if (PUBLIC_PATHS.has(urlPath)) return;

    const isApiRoute = req.url.startsWith("/api/");
    const isWsRoute = req.url.startsWith("/ws/");
    if (!isApiRoute && !isWsRoute) return;

    if (!verifyPresentedToken(req, token)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
