import type { FastifyInstance } from "fastify";
import {
  AccessDeniedError,
  ConflictError,
  MigrationRequiredError,
  NotFoundError,
  ValidationError,
} from "@spherse/core";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function forbidden(message: string): HttpError {
  return new HttpError(403, message);
}

export function notFound(message: string): HttpError {
  return new HttpError(404, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerCoreErrorHandler(fastify: FastifyInstance): void {
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
    if (err instanceof MigrationRequiredError) {
      return reply.code(410).send({ reason: "legacy-unmigrated" });
    }
    if (err instanceof Error && "validation" in err && err.validation) {
      return reply.code(400).send({ error: err.message });
    }
    req.log.error({ err }, "unhandled request error");
    reply.code(500).send({ error: errorMessage(err) });
  });
}
