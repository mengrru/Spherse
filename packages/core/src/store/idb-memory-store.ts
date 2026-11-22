import type { FsPort } from "./fs-port.js";
import type { Logger } from "../logger.js";
import { NotFoundError, ValidationError } from "../errors.js";
import {
  type MemoryEntry,
  type MemoryEntryPatch,
  type MemoryStorePort,
  LIST_LIMIT,
  SEARCH_LIMIT,
  MEMORY_DIR,
  CORE_FILE,
  MAX_CORE_CHARS,
  MAX_ENTRY_CONTENT_CHARS,
  normalizeTags,
} from "./memory-port.js";
import { openDatabase, requestAsPromise } from "./idb-util.js";

interface EntryRecord {
  id: string;
  content: string;
  tags: string;
  kind: string;
  source?: string | null;
  createdAt: number;
  updatedAt: number;
}

const noopLogger: Logger = {
  level: "silent",
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
} as unknown as Logger;

function recordToEntry(record: EntryRecord): MemoryEntry {
  let tags: string[] | undefined;
  try {
    const parsed = JSON.parse(record.tags) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      tags = parsed.filter((t): t is string => typeof t === "string");
    }
  } catch {
    tags = undefined;
  }
  return {
    id: record.id,
    content: record.content,
    tags: tags && tags.length > 0 ? tags : undefined,
    kind: record.kind ?? "fact",
    source: record.source ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function assertEntryContent(content: string): void {
  if (content.trim().length === 0) {
    throw new ValidationError("memory content must not be empty");
  }
  if (content.length > MAX_ENTRY_CONTENT_CHARS) {
    throw new ValidationError(
      `memory content exceeds ${MAX_ENTRY_CONTENT_CHARS} characters; split it into smaller entries`,
    );
  }
}

function assertCoreContent(content: string): void {
  if (content.length > MAX_CORE_CHARS) {
    throw new ValidationError(
      `core memory exceeds ${MAX_CORE_CHARS} characters; prune it or move granular facts into memory_save`,
    );
  }
}

export class IdbMemoryStore implements MemoryStorePort {
  private readonly db: IDBDatabase;
  private readonly fsPort: FsPort;
  private readonly relCorePath: string;
  private readonly logger: Logger;
  private readonly entries = new Map<string, EntryRecord>();
  private coreWriteChain: Promise<unknown> = Promise.resolve();

  private constructor(db: IDBDatabase, fsPort: FsPort, relCorePath: string, logger?: Logger) {
    this.db = db;
    this.fsPort = fsPort;
    this.relCorePath = relCorePath;
    this.logger = logger ?? noopLogger;
  }

  static async open(storeKey: string, fsPort: FsPort, relCorePath = `${MEMORY_DIR}/${CORE_FILE}`, logger?: Logger): Promise<IdbMemoryStore> {
    const db = await openDatabase(`spherse-memory:${storeKey}`, 1, (db) => {
      if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", { keyPath: "id" });
    });
    const store = new IdbMemoryStore(db, fsPort, relCorePath, logger);
    const tx = db.transaction("entries", "readonly");
    const rows = await requestAsPromise(tx.objectStore("entries").getAll() as IDBRequest<EntryRecord[]>);
    for (const row of rows) store.entries.set(row.id, row);
    return store;
  }

  close(): void {
    this.db.close();
  }

  private persist(record: EntryRecord): void {
    try {
      const tx = this.db.transaction("entries", "readwrite");
      tx.objectStore("entries").put(record);
    } catch (err) {
      this.logger.warn({ err }, "idb memory persist failed");
    }
  }

  private persistDelete(id: string): void {
    try {
      const tx = this.db.transaction("entries", "readwrite");
      tx.objectStore("entries").delete(id);
    } catch (err) {
      this.logger.warn({ err }, "idb memory persist delete failed");
    }
  }

  private enqueueCoreWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.coreWriteChain.then(fn, fn);
    this.coreWriteChain = next.catch(() => undefined);
    return next;
  }

  private async readCoreFile(): Promise<string> {
    try {
      return await this.fsPort.readFile(this.relCorePath);
    } catch (err) {
      if ((err as DOMException)?.name === "NotFoundError") return "";
      throw err;
    }
  }

  private async writeCoreFile(content: string): Promise<void> {
    const segments = this.relCorePath.split("/");
    const dir = segments.slice(0, -1).join("/");
    if (dir) await this.fsPort.mkdirp(dir);
    await this.fsPort.writeFile(this.relCorePath, content);
  }

  async getCore(): Promise<string> {
    return this.readCoreFile();
  }

  async saveCore(content: string): Promise<void> {
    assertCoreContent(content);
    await this.enqueueCoreWrite(() => this.writeCoreFile(content));
  }

  async appendCore(content: string): Promise<string> {
    const piece = content.trim();
    if (piece.length === 0) {
      throw new ValidationError("core memory append content must not be empty");
    }
    return this.enqueueCoreWrite(async () => {
      const current = await this.readCoreFile();
      const next = current.length === 0 ? piece : `${current}\n${piece}`;
      assertCoreContent(next);
      await this.writeCoreFile(next);
      return next;
    });
  }

  private sortedEntries(): EntryRecord[] {
    return [...this.entries.values()].sort((a, b) => b.createdAt - a.createdAt || (b.id < a.id ? -1 : 1));
  }

  count(): number {
    return this.entries.size;
  }

  list(limit = LIST_LIMIT): MemoryEntry[] {
    return this.sortedEntries().slice(0, limit).map(recordToEntry);
  }

  save(content: string, tags?: string[]): MemoryEntry {
    assertEntryContent(content);
    const normTags = normalizeTags(tags);
    const now = Date.now();
    const id = crypto.randomUUID();
    const record: EntryRecord = {
      id,
      content,
      tags: JSON.stringify(normTags ?? []),
      kind: "fact",
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(id, record);
    this.persist(record);
    return recordToEntry(record);
  }

  update(id: string, patch: MemoryEntryPatch): MemoryEntry {
    if (patch.content === undefined && patch.tags === undefined) {
      throw new ValidationError("memory entry patch must set content or tags");
    }
    const record = this.entries.get(id);
    if (!record) throw new NotFoundError(`memory entry "${id}" not found`);
    const content = patch.content !== undefined ? patch.content : record.content;
    if (patch.content !== undefined) assertEntryContent(content);
    const tags = patch.tags !== undefined ? normalizeTags(patch.tags) : recordToEntry(record).tags;
    record.content = content;
    record.tags = JSON.stringify(tags ?? []);
    record.updatedAt = Date.now();
    this.persist(record);
    return recordToEntry(record);
  }

  deleteEntry(id: string): void {
    if (!this.entries.has(id)) throw new NotFoundError(`memory entry "${id}" not found`);
    this.entries.delete(id);
    this.persistDelete(id);
  }

  search(query: string, limit = SEARCH_LIMIT): MemoryEntry[] {
    const q = query.trim();
    if (!q) return this.list(limit);
    const terms = q.split(/\s+/).map((term) => term.toLowerCase());
    const matched = this.sortedEntries()
      .sort((a, b) => b.updatedAt - a.updatedAt || (b.id < a.id ? -1 : 1))
      .filter((record) => {
        const haystack = `${record.content}\n${record.tags}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    return matched.slice(0, limit).map(recordToEntry);
  }
}
