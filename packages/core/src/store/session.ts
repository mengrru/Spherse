import Database from "better-sqlite3";
import crypto from "node:crypto";
import type { SessionInfo } from "../types.js";
import { type Logger, createSilentLogger } from "../logger.js";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  source TEXT DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
`;

export class SessionStore {
  private dbPath: string;
  private agentId: string;
  private db: Database.Database;
  private logger: Logger;

  constructor(dbPath: string, agentId: string, logger?: Logger) {
    this.dbPath = dbPath;
    this.agentId = agentId;
    this.logger = logger ?? createSilentLogger();
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.applyMigrations();
    this.logger.info({ agentId, dbPath }, "session db opened for agent");
  }

  private applyMigrations(): void {
    this.db.exec(MIGRATION);
    const cols = this.db.prepare("PRAGMA table_info(sessions)").all() as any[];
    if (!cols.some((c: any) => c.name === "source")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'manual'");
    }
  }

  createSession(title?: string, source?: string): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db.prepare(
      "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status, source) VALUES (?, ?, ?, ?, ?, 'active', ?)",
    ).run(id, this.agentId, title ?? null, now, now, source ?? "manual");
    this.logger.info({ sessionId: id, agentId: this.agentId }, "session created in store");
    return id;
  }

  getSession(id: string): SessionInfo | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      agentId: row.agent_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
      source: row.source ?? "manual",
    };
  }

  listSessions(): SessionInfo[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM sessions WHERE agent_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC",
      )
      .all(this.agentId) as any[];
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
      source: row.source ?? "manual",
    }));
  }

  listSessionsPage(limit: number, offset: number): { items: SessionInfo[]; hasMore: boolean } {
    const rows = this.db
      .prepare(
        "SELECT * FROM sessions WHERE agent_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
      )
      .all(this.agentId, limit + 1, offset) as any[];
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
      source: row.source ?? "manual",
    }));
    return { items, hasMore };
  }

  archiveSession(sessionId: string): void {
    this.db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?").run(sessionId);
  }

  appendMessage(sessionId: string, message: any): void {
    const now = Date.now();
    const insertMessage = this.db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
    );
    const updateSession = this.db.prepare(
      "UPDATE sessions SET updated_at = ? WHERE id = ?",
    );
    this.db.transaction(() => {
      insertMessage.run(sessionId, message.role, JSON.stringify(message), message.timestamp ?? now);
      updateSession.run(now, sessionId);
    })();
    this.logger.debug({ sessionId }, "message persisted");
  }

  getSessionMessages(sessionId: string): any[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC")
      .all(sessionId) as any[];
    return rows.map((row) => JSON.parse(row.content));
  }

  getRecentTurns(
    sessionId: string,
    turns: number,
    beforeId?: number,
  ): { messages: any[]; hasMore: boolean; oldestId: number | null } {
    let cursor: number;
    if (beforeId !== undefined) {
      cursor = beforeId;
    } else {
      const maxRow = this.db
        .prepare("SELECT MAX(id) AS maxId FROM messages WHERE session_id = ?")
        .get(sessionId) as { maxId: number | null } | undefined;
      if (!maxRow || maxRow.maxId === null) {
        return { messages: [], hasMore: false, oldestId: null };
      }
      cursor = maxRow.maxId + 1;
    }

    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? AND id < ? ORDER BY id DESC")
      .all(sessionId, cursor) as any[];

    if (rows.length === 0) {
      return { messages: [], hasMore: false, oldestId: null };
    }

    const collected: { id: number; message: any }[] = [];
    let turnCount = 0;
    for (const row of rows) {
      const msg = JSON.parse(row.content);
      collected.push({ id: row.id, message: msg });
      if (msg.role === "user") {
        turnCount++;
        if (turnCount >= turns) {
          break;
        }
      }
    }

    const hasMore = collected.length < rows.length;
    const oldestId = collected.length > 0 ? collected[collected.length - 1].id : null;
    const messages = collected.map((c) => c.message).reverse();
    return { messages, hasMore, oldestId };
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, sessionId);
  }

  close(): void {
    this.db.close();
  }
}
