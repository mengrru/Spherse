import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verifyPresentedToken } from "./auth.js";

const PREFLIGHT_MAX_AGE = 600;

export function registerAuthGatedCors(fastify: FastifyInstance, getToken: () => string | undefined): void {
  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    if (typeof origin !== "string" || origin === "") return;

    if (req.method === "OPTIONS") {
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Vary", "Origin")
        .header("Access-Control-Allow-Methods", req.headers["access-control-request-method"] ?? "GET,POST,PUT,DELETE,PATCH,OPTIONS")
        .header("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "Authorization,Content-Type")
        .header("Access-Control-Max-Age", String(PREFLIGHT_MAX_AGE));
      return reply.code(204).send();
    }

    const token = getToken();
    if (token && verifyPresentedToken(req, token)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
  });
}
