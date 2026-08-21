import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileWriteMutex } from "../../utils/file-write-mutex.js";
import type { Logger } from "../../logger.js";
import { OutlineCache } from "./outline-cache.js";
import { buildOutline } from "./outline.js";
import { checkManifestHealth, readManifestFromDoc } from "./manifest.js";
import { getByDotPath, getRawByDotPath } from "./dot-path.js";
import { runQuery, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "./query-engine.js";
import { validateMutationArgs } from "./validate.js";
import { isReservedKey, resolveDataFile, toPosixRelative } from "./path-guard.js";
import {
  DataFileCorruptedError,
  ForbiddenKeyError,
  ManifestStaleError,
  UnknownEntryError,
  VersionConflictError,
  type DataChangeEvent,
  type DataOrigin,
  type DataStore,
  type ManifestMutation,
  type MutateResult,
  type OutlineResult,
  type QueryResult,
  type ReadResult,
  type WriteResult,
} from "./types.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const IDEMPOTENCY_CACHE_CAPACITY = 1024;

interface LoadedDoc {
  doc: Record<string, unknown>;
  version: string;
  existed: boolean;
}

export interface CreateDataStoreOptions {
  projectRoot: string;
  fileWriteMutex: FileWriteMutex;
  logger: Logger;
}

export function createDataStore(opts: CreateDataStoreOptions): DataStore {
  const root = path.resolve(opts.projectRoot);
  const mutex = opts.fileWriteMutex;
  const logger = opts.logger;
  const outlineCache = new OutlineCache(64);
  const changeHandlers = new Set<(e: DataChangeEvent) => void>();
  const idempotencyCache = new Map<string, unknown>();

  function sha256(buf: Buffer): string {
    return crypto.createHash("sha256").update(buf).digest("hex");
  }

  function tmpPathFor(absPath: string): string {
    return path.join(path.dirname(absPath), `.${path.basename(absPath)}.spdata.tmp`);
  }

  async function loadDoc(absPath: string): Promise<LoadedDoc> {
    let buf: Buffer;
    try {
      buf = await fs.readFile(absPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { doc: {}, version: sha256(Buffer.alloc(0)), existed: false };
      }
      throw err;
    }
    if (buf.length > MAX_FILE_SIZE) {
      throw new Error(`data file exceeds 20MB limit: ${toPosixRelative(root, absPath)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString("utf8"));
    } catch {
      throw new DataFileCorruptedError(toPosixRelative(root, absPath));
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new DataFileCorruptedError(toPosixRelative(root, absPath));
    }
    return { doc: parsed as Record<string, unknown>, version: sha256(buf), existed: true };
  }

  let pendingEvents: DataChangeEvent[] = [];

  function flushEvents(): void {
    const events = pendingEvents;
    pendingEvents = [];
    for (const event of events) {
      for (const handler of changeHandlers) {
        try {
          handler(event);
        } catch (err) {
          logger.warn({ err, file: event.file }, "data change handler failed");
        }
      }
    }
  }

  async function readBytesForVersion(absPath: string): Promise<LoadedDoc> {
    return loadDoc(absPath);
  }

  async function persistLocked(
    absPath: string,
    doc: Record<string, unknown>,
    origin: DataOrigin,
    summary?: string,
  ): Promise<string> {
    const content = JSON.stringify(doc, null, 2);
    const buf = Buffer.from(content, "utf8");
    if (buf.length > MAX_FILE_SIZE) {
      throw new Error(`data file exceeds 20MB limit: ${toPosixRelative(root, absPath)}`);
    }
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const tmp = tmpPathFor(absPath);
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, absPath);
    const version = sha256(buf);
    outlineCache.invalidateFile(absPath);
    pendingEvents.push({
      file: toPosixRelative(root, absPath),
      version,
      origin,
      ...(summary !== undefined ? { summary } : {}),
    });
    return version;
  }

  function rememberIdempotent(absPath: string, key: string | undefined, result: unknown): void {
    if (key === undefined) return;
    const cacheKey = `${absPath}\0${key}`;
    if (idempotencyCache.has(cacheKey)) idempotencyCache.delete(cacheKey);
    idempotencyCache.set(cacheKey, result);
    while (idempotencyCache.size > IDEMPOTENCY_CACHE_CAPACITY) {
      const oldest = idempotencyCache.keys().next().value;
      if (oldest === undefined) break;
      idempotencyCache.delete(oldest);
    }
  }

  function recallIdempotent(absPath: string, key: string | undefined): unknown {
    if (key === undefined) return undefined;
    const cacheKey = `${absPath}\0${key}`;
    const value = idempotencyCache.get(cacheKey);
    if (value !== undefined) {
      idempotencyCache.delete(cacheKey);
      idempotencyCache.set(cacheKey, value);
    }
    return value;
  }

  async function writeRaw(
    file: string,
    key: string,
    apply: (doc: Record<string, unknown>) => boolean,
    ifVersion: string | undefined,
  ): Promise<WriteResult> {
    if (typeof key !== "string" || !key) throw new Error("key must be a non-empty string");
    if (isReservedKey(key)) throw new ForbiddenKeyError(key);
    const absPath = resolveDataFile(root, file);
    const result = await mutex.run(absPath, async () => {
      const loaded = await loadDoc(absPath);
      if (ifVersion !== undefined && loaded.version !== ifVersion) {
        throw new VersionConflictError(loaded.version);
      }
      const changed = apply(loaded.doc);
      if (!changed) return { version: loaded.version };
      const version = await persistLocked(absPath, loaded.doc, "sdk");
      return { version };
    });
    flushEvents();
    return result;
  }

  function manifestQueriesOf(raw: unknown): Record<string, unknown> {
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof (raw as { queries?: unknown }).queries === "object"
      ? ((raw as { queries: Record<string, unknown> }).queries ?? {})
      : {};
  }

  function manifestMutationsOf(raw: unknown): Record<string, unknown> {
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof (raw as { mutations?: unknown }).mutations === "object"
      ? ((raw as { mutations: Record<string, unknown> }).mutations ?? {})
      : {};
  }

  function applyMutation(
    doc: Record<string, unknown>,
    mutation: ManifestMutation,
    args: Record<string, unknown>,
    entryName: string,
    validNames: string[],
  ): unknown {
    const validated = validateMutationArgs(mutation, args);
    const target = getByDotPath(doc, mutation.path);

    if (mutation.op === "append") {
      if (target.missing || !Array.isArray(target.value)) {
        throw new ManifestStaleError(entryName, "mutation", validNames);
      }
      const row: Record<string, unknown> = { ...validated.value };
      for (const [field, gen] of Object.entries(mutation.auto ?? {})) {
        if (field === mutation.match) continue;
        row[field] = gen === "uuid" ? randomUUID() : new Date().toISOString();
      }
      target.value.push(row);
      return row;
    }

    if (mutation.op === "update" || mutation.op === "remove") {
      if (target.missing || !Array.isArray(target.value)) {
        throw new ManifestStaleError(entryName, "mutation", validNames);
      }
      if (!mutation.match) throw new Error(`mutation "${mutation.op}" requires a match field`);
      const matchValue = validated.value[mutation.match];
      const idx = target.value.findIndex(
        (r) => typeof r === "object" && r !== null && !Array.isArray(r) && (r as Record<string, unknown>)[mutation.match!] === matchValue,
      );
      if (idx < 0) {
        throw new Error(`no entry with ${mutation.match}=${JSON.stringify(matchValue)} in ${mutation.path}`);
      }
      if (mutation.op === "remove") {
        const [removed] = target.value.splice(idx, 1);
        return removed;
      }
      const row = target.value[idx] as Record<string, unknown>;
      for (const [field, value] of Object.entries(validated.value)) {
        if (field === mutation.match) continue;
        row[field] = value;
      }
      for (const [field, gen] of Object.entries(mutation.auto ?? {})) {
        if (field === mutation.match || validated.value[field] !== undefined) continue;
        row[field] = gen === "uuid" ? randomUUID() : new Date().toISOString();
      }
      return row;
    }

    if (mutation.op === "set") {
      const parentPath = mutation.path.includes(".")
        ? mutation.path.slice(0, mutation.path.lastIndexOf("."))
        : ".";
      const leaf = mutation.path.includes(".") ? mutation.path.slice(mutation.path.lastIndexOf(".") + 1) : mutation.path;
      const parent = getRawByDotPath(doc, parentPath);
      if (parent.missing || typeof parent.value !== "object" || parent.value === null || Array.isArray(parent.value)) {
        throw new ManifestStaleError(entryName, "mutation", validNames);
      }
      const patch: Record<string, unknown> = { ...validated.value };
      for (const [field, gen] of Object.entries(mutation.auto ?? {})) {
        patch[field] = gen === "uuid" ? randomUUID() : new Date().toISOString();
      }
      const target = (parent.value as Record<string, unknown>)[leaf];
      (parent.value as Record<string, unknown>)[leaf] = {
        ...(typeof target === "object" && target !== null && !Array.isArray(target) ? target : {}),
        ...patch,
      };
      return (parent.value as Record<string, unknown>)[leaf];
    }

    throw new Error(`unsupported mutation op: ${mutation.op}`);
  }

  async function mutateImpl(
    absPath: string,
    name: string,
    args: Record<string, unknown>,
    opts: { idempotencyKey?: string; origin?: DataOrigin } | undefined,
  ): Promise<MutateResult> {
    const origin: DataOrigin = opts?.origin ?? "agent";
    const idemKey = opts?.idempotencyKey !== undefined ? `${name}\0${opts.idempotencyKey}` : undefined;
    const cached = recallIdempotent(absPath, idemKey);
    if (cached !== undefined) return cached as MutateResult;

    const result = await mutex.run(absPath, async () => {
      const inFlight = recallIdempotent(absPath, idemKey);
      if (inFlight !== undefined) return inFlight as MutateResult;

      const loaded = await loadDoc(absPath);
      const manifest = readManifestFromDoc(loaded.doc);
      if (!manifest) {
        throw new UnknownEntryError(name, "mutation", Object.keys(manifestMutationsOf(loaded.doc.$manifest)));
      }
      const mutation = manifest.mutations[name];
      if (!mutation) {
        throw new UnknownEntryError(name, "mutation", Object.keys(manifest.mutations));
      }
      const health = checkManifestHealth(loaded.doc, manifest);
      if (health.staleMutations.includes(name)) {
        throw new ManifestStaleError(name, "mutation", Object.keys(manifest.mutations));
      }
      const result = applyMutation(loaded.doc, mutation, args, name, Object.keys(manifest.mutations));
      const version = await persistLocked(absPath, loaded.doc, origin, name);
      const full = { version, result } satisfies MutateResult;
      rememberIdempotent(absPath, idemKey, full);
      return full;
    });
    flushEvents();
    return result;
  }

  const store: DataStore = {
    async outline(file): Promise<OutlineResult> {
      const absPath = resolveDataFile(root, file);
      let sizeBytes = 0;
      let buf: Buffer;
      try {
        buf = await fs.readFile(absPath);
        sizeBytes = buf.length;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        buf = Buffer.alloc(0);
      }
      if (buf.length > MAX_FILE_SIZE) {
        throw new Error(`data file exceeds 20MB limit: ${toPosixRelative(root, absPath)}`);
      }
      let doc: Record<string, unknown> = {};
      let parsed: unknown;
      try {
        parsed = buf.length > 0 ? JSON.parse(buf.toString("utf8")) : {};
      } catch {
        throw new DataFileCorruptedError(toPosixRelative(root, absPath));
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new DataFileCorruptedError(toPosixRelative(root, absPath));
      }
      doc = parsed as Record<string, unknown>;
      const version = sha256(buf);

      const manifest = readManifestFromDoc(doc);
      const health = checkManifestHealth(doc, manifest);
      const cached = outlineCache.get(absPath, version);
      if (cached !== undefined) {
        return { file: toPosixRelative(root, absPath), sizeBytes, version, outline: cached, health };
      }
      const outline = buildOutline(doc, { file: toPosixRelative(root, absPath), version, sizeBytes, manifest, health });
      outlineCache.set(absPath, version, outline);
      return { file: toPosixRelative(root, absPath), sizeBytes, version, outline, health };
    },

    async read(file, opts): Promise<ReadResult> {
      const absPath = resolveDataFile(root, file);
      if (opts.key !== undefined && opts.path !== undefined) {
        throw new Error("key and path are mutually exclusive");
      }
      const loaded = await readBytesForVersion(absPath);
      if (opts.ifVersion !== undefined) {
        if (loaded.version !== opts.ifVersion) {
          throw new VersionConflictError(loaded.version);
        }
        return { version: loaded.version, unchanged: true };
      }
      if (opts.key !== undefined) {
        if (typeof opts.key !== "string" || !opts.key) throw new Error("key must be a non-empty string");
        if (isReservedKey(opts.key)) throw new ForbiddenKeyError(opts.key);
        const value = opts.key in loaded.doc ? loaded.doc[opts.key] : null;
        return { version: loaded.version, value };
      }
      if (opts.path === undefined) {
        const o = await store.outline(file);
        return { version: o.version, note: "outline", value: o.outline };
      }
      const result = getByDotPath(loaded.doc, opts.path);
      if (result.missing) {
        return { version: loaded.version, value: null, note: `path not found: ${opts.path}` };
      }
      if (Array.isArray(result.value)) {
        const total = result.value.length;
        const offset = Math.max(opts.offset ?? 0, 0);
        const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
        const slice = result.value.slice(offset, offset + limit);
        return {
          version: loaded.version,
          value: slice,
          total,
          offset,
          limit,
          truncated: offset + slice.length < total,
          ...(total > offset + slice.length
            ? { note: `array sliced: ${offset}..${offset + slice.length} of ${total} — pass offset=${offset + slice.length} for next page` }
            : {}),
        };
      }
      return { version: loaded.version, value: result.value };
    },

    async query(file, name, params = {}, page): Promise<QueryResult> {
      const absPath = resolveDataFile(root, file);
      const loaded = await readBytesForVersion(absPath);
      const manifest = readManifestFromDoc(loaded.doc);
      const query = manifest?.queries[name];
      if (!query) {
        const raw = loaded.doc.$manifest;
        throw new UnknownEntryError(
          name,
          "query",
          raw === undefined ? [] : Object.keys(manifestQueriesOf(raw)),
        );
      }
      const health = checkManifestHealth(loaded.doc, manifest);
      if (health.staleQueries.includes(name)) {
        throw new ManifestStaleError(name, "query", Object.keys(manifest.queries));
      }
      const result = runQuery(loaded.doc, query, params, page);
      result.version = loaded.version;
      return result;
    },

    async mutate(file, name, args, opts): Promise<MutateResult> {
      const absPath = resolveDataFile(root, file);
      return mutateImpl(absPath, name, args, opts);
    },

    async rawSet(file, key, value, opts) {
      return writeRaw(
        file,
        key,
        (doc) => {
          if (deepEqual(doc[key], value)) return false;
          doc[key] = value;
          return true;
        },
        opts?.ifVersion,
      );
    },

    async rawDelete(file, key, opts) {
      return writeRaw(
        file,
        key,
        (doc) => {
          if (!(key in doc)) return false;
          delete doc[key];
          return true;
        },
        opts?.ifVersion,
      );
    },

    onChange(handler) {
      changeHandlers.add(handler);
      return () => changeHandlers.delete(handler);
    },
  };

  return store;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
