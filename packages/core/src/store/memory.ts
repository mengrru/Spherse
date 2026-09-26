import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { NotFoundError, ValidationError } from "../errors.js";
import { escapeLikePattern } from "../session/search.js";
import { type Logger, createSilentLogger } from "../logger.js";

export interface MemoryEntry {
  id: string;
  content: string;
  tags?: string[];
  kind: string;
  source?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryEntryPatch {
  content?: string;
  tags?: string[];
}

export const MEMORY_DIR = "memory";
export const CORE_FILE = "core.md";
export const DB_FILE = "memory.db";
export const MAX_CORE_CHARS = 4000;
export const MAX_ENTRY_CONTENT_CHARS = 2000;
export const MAX_TAGS = 8;
export const MAX_TAG_CHARS = 24;
export const RECALL_LIMIT = 8;
export const LIST_LIMIT = 200;
export const SEARCH_LIMIT = 50;

const DDL = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'fact',
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  content, tags, tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  DELETE FROM entries_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  DELETE FROM entries_fts WHERE rowid = old.rowid;
  INSERT INTO entries_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;
`;

interface EntryRow {
  id: string;
  content: string;
  tags: string;
  kind: string;
  source: string | null;
  created_at: number;
  updated_at: number;
}

function rowToEntry(row: EntryRow): MemoryEntry {
  let tags: string[] | undefined;
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed) && parsed.length > 0) {
      tags = parsed.filter((t): t is string => typeof t === "string");
    }
  } catch {
    tags = undefined;
  }
  return {
    id: row.id,
    content: row.content,
    tags: tags && tags.length > 0 ? tags : undefined,
    kind: row.kind ?? "fact",
    source: row.source ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags || tags.length === 0) return undefined;
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))];
  if (cleaned.length === 0) return undefined;
  if (cleaned.length > MAX_TAGS) {
    throw new ValidationError(`memory tags allow at most ${MAX_TAGS} entries`);
  }
  for (const tag of cleaned) {
    if (tag.length > MAX_TAG_CHARS) {
      throw new ValidationError(`memory tag exceeds ${MAX_TAG_CHARS} characters`);
    }
  }
  return cleaned;
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

export class MemoryStore {
  private readonly dbPath: string;
  private readonly corePath: string;
  private readonly db: Database.Database;
  private readonly logger: Logger;
  private coreWriteChain: Promise<unknown> = Promise.resolve();

  constructor(agentDir: string, logger?: Logger) {
    this.dbPath = path.join(agentDir, MEMORY_DIR, DB_FILE);
    this.corePath = path.join(agentDir, MEMORY_DIR, CORE_FILE);
    this.logger = logger ?? createSilentLogger();
    this.db = this.openDatabase();
  }

  close(): void {
    this.db.close();
  }

  private openDatabase(): Database.Database {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    try {
      return this.openAndMigrate();
    } catch (err) {
      const backup = `${this.dbPath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.dbPath, backup);
      } catch {
        // nothing more we can do; the retry below will surface the error
      }
      this.logger.warn({ err, dbPath: this.dbPath, backup }, "memory db unreadable, isolated and recreated");
      return this.openAndMigrate();
    }
  }

  private openAndMigrate(): Database.Database {
    const db = new Database(this.dbPath);
    try {
      db.pragma("journal_mode = WAL");
      db.exec(DDL);
      return db;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  private enqueueCoreWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.coreWriteChain.then(fn, fn);
    this.coreWriteChain = next.catch(() => undefined);
    return next;
  }

  private async readCoreFile(): Promise<string> {
    try {
      return await fsp.readFile(this.corePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  }

  private async writeCoreFile(content: string): Promise<void> {
    await fsp.mkdir(path.dirname(this.corePath), { recursive: true });
    await fsp.writeFile(this.corePath, content, "utf-8");
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

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number };
    return row.n;
  }

  list(limit = LIST_LIMIT): MemoryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM entries ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit) as EntryRow[];
    return rows.map(rowToEntry);
  }

  save(content: string, tags?: string[]): MemoryEntry {
    assertEntryContent(content);
    const normTags = normalizeTags(tags);
    const now = Date.now();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        "INSERT INTO entries (id, content, tags, kind, created_at, updated_at) VALUES (?, ?, ?, 'fact', ?, ?)",
      )
      .run(id, content, JSON.stringify(normTags ?? []), now, now);
    return { id, content, tags: normTags, kind: "fact", createdAt: now, updatedAt: now };
  }

  update(id: string, patch: MemoryEntryPatch): MemoryEntry {
    const row = this.db.prepare("SELECT * FROM entries WHERE id = ?").get(id) as EntryRow | undefined;
    if (!row) throw new NotFoundError(`memory entry "${id}" not found`);
    const content = patch.content !== undefined ? patch.content : row.content;
    if (patch.content !== undefined) assertEntryContent(content);
    const tags =
      patch.tags !== undefined ? normalizeTags(patch.tags) : rowToEntry(row).tags;
    const now = Date.now();
    this.db
      .prepare("UPDATE entries SET content = ?, tags = ?, updated_at = ? WHERE id = ?")
      .run(content, JSON.stringify(tags ?? []), now, id);
    return { ...rowToEntry(row), content, tags, updatedAt: now };
  }

  deleteEntry(id: string): void {
    const result = this.db.prepare("DELETE FROM entries WHERE id = ?").run(id);
    if (result.changes === 0) throw new NotFoundError(`memory entry "${id}" not found`);
  }

  search(query: string, limit = SEARCH_LIMIT): MemoryEntry[] {
    const q = query.trim();
    if (!q) return this.list(limit);
    const terms = q.split(/\s+/);
    if (terms.every((t) => t.length >= 3)) {
      try {
        const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
        const rows = this.db
          .prepare(
            `SELECT e.* FROM entries_fts f JOIN entries e ON e.rowid = f.rowid
             WHERE entries_fts MATCH ?
             ORDER BY bm25(entries_fts), e.created_at DESC
             LIMIT ?`,
          )
          .all(match, limit) as EntryRow[];
        return rows.map(rowToEntry);
      } catch (err) {
        this.logger.warn({ err, query: q }, "memory fts search failed, falling back to LIKE");
      }
    }
    return this.likeSearch(terms, limit);
  }

  private likeSearch(terms: string[], limit: number): MemoryEntry[] {
    const clauses = terms
      .map(() => "(content LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
      .join(" AND ");
    const patterns = terms.flatMap((t) => {
      const pattern = `%${escapeLikePattern(t)}%`;
      return [pattern, pattern];
    });
    const rows = this.db
      .prepare(`SELECT * FROM entries WHERE ${clauses} ORDER BY updated_at DESC, rowid DESC LIMIT ?`)
      .all(...patterns, limit) as EntryRow[];
    return rows.map(rowToEntry);
  }
}
