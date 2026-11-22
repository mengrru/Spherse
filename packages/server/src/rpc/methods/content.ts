import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  BINARY_SAMPLE_SIZE,
  DataFileCorruptedError,
  DataValidationError,
  ForbiddenKeyError,
  ManifestStaleError,
  UnknownEntryError,
  VersionConflictError,
  isBinaryBuffer,
  resolveProjectPath,
  serverAccessPolicy,
  shouldSkipDirEntry,
  type DataStore,
} from "@spherse/core";
import { CONTENT_ERROR_CODES, parseContract, schemas } from "@spherse/contracts";
import { RpcAppError, defineRpcMethod, type RpcContext, type RpcMethodEntry } from "@spherse/rpc";

async function readFileContent(absolutePath: string): Promise<{ content: string; binary: boolean }> {
  const handle = await fs.open(absolutePath, "r");
  try {
    const head = Buffer.alloc(BINARY_SAMPLE_SIZE);
    const { bytesRead } = await handle.read(head, 0, BINARY_SAMPLE_SIZE, 0);
    if (isBinaryBuffer(head.subarray(0, bytesRead))) {
      return { content: "", binary: true };
    }
  } finally {
    await handle.close();
  }
  const content = await fs.readFile(absolutePath, "utf-8");
  return { content, binary: false };
}

async function walkDir(absoluteDir: string, relativeDir: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (shouldSkipDirEntry(entry.name)) continue;
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkDir(path.join(absoluteDir, entry.name), relativePath, files);
    } else {
      files.push(relativePath);
    }
  }
}

function dataStoreOf(ctx: RpcContext, projectId: string): DataStore {
  const project = ctx.resolveProject(projectId);
  const store = project.runtime.dataStore;
  if (!store) throw new RpcAppError(102, "data store not available for this project");
  return store;
}

function toDataAppError(err: unknown): RpcAppError {
  if (err instanceof VersionConflictError) {
    return new RpcAppError(409, "version conflict", {
      code: "version_conflict",
      currentVersion: err.currentVersion,
    });
  }
  if (err instanceof UnknownEntryError) {
    return new RpcAppError(404, err.message, { code: "unknown_entry", validNames: err.validNames });
  }
  if (err instanceof ManifestStaleError) {
    return new RpcAppError(409, err.message, { code: "manifest_stale", validNames: err.validNames });
  }
  if (err instanceof DataValidationError) {
    return new RpcAppError(400, err.message, { code: "validation_failed", fields: err.fields });
  }
  if (err instanceof DataFileCorruptedError) {
    return new RpcAppError(422, err.message, { code: "file_corrupted" });
  }
  if (err instanceof ForbiddenKeyError) {
    return new RpcAppError(400, err.message, { code: "forbidden_key" });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new RpcAppError(400, message, { code: "bad_request" });
}

const stat = defineRpcMethod(
  Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const root = projectManager.getRootPath();
    serverAccessPolicy(root).assertRead(params.path);
    const absolutePath = resolveProjectPath(root, params.path);
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      throw new RpcAppError(100, "Not found");
    }
    return parseContract(schemas.statResponse, {
      size: stat.size,
      mtime: stat.mtimeMs,
      isDirectory: stat.isDirectory(),
    });
  },
);

const read = defineRpcMethod(
  Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    const root = projectManager.getRootPath();
    serverAccessPolicy(root).assertRead(params.path);
    const absolutePath = resolveProjectPath(root, params.path);
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      throw new RpcAppError(100, "Not found", { code: CONTENT_ERROR_CODES.FILE_NOT_FOUND });
    }
    if (stat.isDirectory()) throw new RpcAppError(102, "Path is a directory");
    const { content, binary } = await readFileContent(absolutePath);
    return parseContract(schemas.contentResponse, { content, path: params.path, binary });
  },
);

const list = defineRpcMethod(
  Type.Object({ projectId: Type.String(), path: Type.Optional(Type.String()) }),
  async (params, ctx) => {
    const relativePath = params.path ?? "";
    const { projectManager } = ctx.resolveProject(params.projectId);
    const root = projectManager.getRootPath();
    serverAccessPolicy(root).assertRead(relativePath);
    const absolutePath = resolveProjectPath(root, relativePath);
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      throw new RpcAppError(100, "Not found");
    }
    if (!stat.isDirectory()) throw new RpcAppError(102, "Path is not a directory");
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    return parseContract(
      schemas.fileEntries,
      entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      })),
    );
  },
);

const save = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    path: Type.String({ minLength: 1 }),
    content: Type.String(),
  }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    await projectManager.writeFile(params.path, params.content);
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const remove = defineRpcMethod(
  Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    await projectManager.deletePath(params.path);
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const mkdir = defineRpcMethod(
  Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    await projectManager.createEntry(params.path, "mkdir");
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const touch = defineRpcMethod(
  Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    await projectManager.createEntry(params.path, "touch");
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const fileTree = defineRpcMethod(
  Type.Object({ projectId: Type.String() }),
  async (params, ctx) => {
    const root = ctx.resolveProject(params.projectId).projectManager.getRootPath();
    const files: string[] = [];
    await walkDir(root, "", files);
    return parseContract(schemas.fileTreeResponse, files);
  },
);

const dataRead = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    file: Type.String({ minLength: 1 }),
    key: Type.Optional(Type.String({ minLength: 1 })),
    path: Type.Optional(Type.String({ minLength: 1 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    ifVersion: Type.Optional(Type.String({ minLength: 8 })),
  }),
  async (params, ctx) => {
    const store = dataStoreOf(ctx, params.projectId);
    try {
      const result = await store.read(params.file, {
        ...(params.key !== undefined ? { key: params.key } : {}),
        ...(params.path !== undefined ? { path: params.path } : {}),
        ...(params.offset !== undefined ? { offset: params.offset } : {}),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.ifVersion !== undefined ? { ifVersion: params.ifVersion } : {}),
      });
      return parseContract(schemas.dataReadResponse, result);
    } catch (err) {
      throw toDataAppError(err);
    }
  },
);

const dataMutate = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    file: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
  }),
  async (params, ctx) => {
    const store = dataStoreOf(ctx, params.projectId);
    try {
      const result = await store.mutate(
        params.file,
        params.name,
        params.args ?? {},
        {
          origin: "sdk",
          ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
        },
      );
      return parseContract(schemas.dataMutateResponse, result);
    } catch (err) {
      throw toDataAppError(err);
    }
  },
);

const dataRawSet = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    file: Type.String({ minLength: 1 }),
    key: Type.String({ minLength: 1 }),
    value: Type.Unknown(),
    ifVersion: Type.Optional(Type.String({ minLength: 8 })),
  }),
  async (params, ctx) => {
    const store = dataStoreOf(ctx, params.projectId);
    try {
      const result = await store.rawSet(params.file, params.key, params.value, {
        ...(params.ifVersion !== undefined ? { ifVersion: params.ifVersion } : {}),
      });
      return parseContract(schemas.dataWriteResponse, result);
    } catch (err) {
      throw toDataAppError(err);
    }
  },
);

const dataRawDelete = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    file: Type.String({ minLength: 1 }),
    key: Type.String({ minLength: 1 }),
    ifVersion: Type.Optional(Type.String({ minLength: 8 })),
  }),
  async (params, ctx) => {
    const store = dataStoreOf(ctx, params.projectId);
    try {
      const result = await store.rawDelete(params.file, params.key, {
        ...(params.ifVersion !== undefined ? { ifVersion: params.ifVersion } : {}),
      });
      return parseContract(schemas.dataWriteResponse, result);
    } catch (err) {
      throw toDataAppError(err);
    }
  },
);

const rename = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    path: Type.String({ minLength: 1 }),
    to: Type.String({ minLength: 1 }),
  }),
  async (params, ctx) => {
    const { projectManager } = ctx.resolveProject(params.projectId);
    await projectManager.renamePath(params.path, params.to);
    return parseContract(schemas.okResponse, { ok: true });
  },
);

export const contentMethods: Record<string, RpcMethodEntry> = {
  "content.stat": stat,
  "content.read": read,
  "content.list": list,
  "content.save": save,
  "content.rename": rename,
  "content.delete": remove,
  "content.mkdir": mkdir,
  "content.touch": touch,
  "content.fileTree": fileTree,
  "data.read": dataRead,
  "data.mutate": dataMutate,
  "data.rawSet": dataRawSet,
  "data.rawDelete": dataRawDelete,
};
