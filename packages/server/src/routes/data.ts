import type { FastifyInstance, FastifyReply } from "fastify";
import {
  DataFileCorruptedError,
  DataValidationError,
  ForbiddenKeyError,
  ManifestStaleError,
  UnknownEntryError,
  VersionConflictError,
  type DataStore,
} from "@spherse/core";
import { schemas, parseContract } from "@spherse/contracts";
import type { ProjectRegistry } from "../registry.js";

function dataStoreOf(registry: ProjectRegistry, req: { params: { projectId: string } }): DataStore {
  const ctx = registry.get(req.params.projectId);
  const store = ctx?.runtime.dataStore;
  if (!store) throw new Error("data store not available for this project");
  return store;
}

function sendDataError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof VersionConflictError) {
    return reply.code(409).send({ error: "version conflict", code: "version_conflict", currentVersion: err.currentVersion });
  }
  if (err instanceof UnknownEntryError) {
    return reply.code(404).send({ error: err.message, code: "unknown_entry", validNames: err.validNames });
  }
  if (err instanceof ManifestStaleError) {
    return reply.code(409).send({ error: err.message, code: "manifest_stale", validNames: err.validNames });
  }
  if (err instanceof DataValidationError) {
    return reply.code(400).send({ error: err.message, code: "validation_failed", fields: err.fields });
  }
  if (err instanceof DataFileCorruptedError) {
    return reply.code(422).send({ error: err.message, code: "file_corrupted" });
  }
  if (err instanceof ForbiddenKeyError) {
    return reply.code(400).send({ error: err.message, code: "forbidden_key" });
  }
  const message = err instanceof Error ? err.message : String(err);
  return reply.code(400).send({ error: message, code: "bad_request" });
}

export function registerDataRoutes(fastify: FastifyInstance, registry: ProjectRegistry): void {
  fastify.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/data/read",
    { schema: { body: schemas.dataReadRequest, response: { 200: schemas.dataReadResponse } } },
    async (req, reply) => {
      const body = parseContract(schemas.dataReadRequest, req.body);
      const store = dataStoreOf(registry, req);
      try {
        const result = await store.read(body.file, {
          ...(body.key !== undefined ? { key: body.key } : {}),
          ...(body.path !== undefined ? { path: body.path } : {}),
          ...(body.offset !== undefined ? { offset: body.offset } : {}),
          ...(body.limit !== undefined ? { limit: body.limit } : {}),
          ...(body.ifVersion !== undefined ? { ifVersion: body.ifVersion } : {}),
        });
        return reply.code(200).send(result);
      } catch (err) {
        return sendDataError(reply, err);
      }
    },
  );

  fastify.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/data/mutate",
    { schema: { body: schemas.dataMutateRequest, response: { 200: schemas.dataMutateResponse } } },
    async (req, reply) => {
      const body = parseContract(schemas.dataMutateRequest, req.body);
      const store = dataStoreOf(registry, req);
      try {
        const result = await store.mutate(
          body.file,
          body.name,
          body.args ?? {},
          {
            origin: "sdk",
            ...(body.idempotencyKey !== undefined ? { idempotencyKey: body.idempotencyKey } : {}),
          },
        );
        return reply.code(200).send(result);
      } catch (err) {
        return sendDataError(reply, err);
      }
    },
  );

  fastify.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/data/raw-set",
    { schema: { body: schemas.dataRawSetRequest, response: { 200: schemas.dataWriteResponse } } },
    async (req, reply) => {
      const body = parseContract(schemas.dataRawSetRequest, req.body);
      const store = dataStoreOf(registry, req);
      try {
        const result = await store.rawSet(body.file, body.key, body.value, {
          ...(body.ifVersion !== undefined ? { ifVersion: body.ifVersion } : {}),
        });
        return reply.code(200).send(result);
      } catch (err) {
        return sendDataError(reply, err);
      }
    },
  );

  fastify.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/data/raw-delete",
    { schema: { body: schemas.dataRawDeleteRequest, response: { 200: schemas.dataWriteResponse } } },
    async (req, reply) => {
      const body = parseContract(schemas.dataRawDeleteRequest, req.body);
      const store = dataStoreOf(registry, req);
      try {
        const result = await store.rawDelete(body.file, body.key, {
          ...(body.ifVersion !== undefined ? { ifVersion: body.ifVersion } : {}),
        });
        return reply.code(200).send(result);
      } catch (err) {
        return sendDataError(reply, err);
      }
    },
  );
}
