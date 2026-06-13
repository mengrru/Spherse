import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { SessionInfo } from "../types.js";
import type { Logger } from "../logger.js";
import pino from "pino";

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
  private agentsDir: string;
  private connections: Map<string, Database.Database> = new Map();
  private dirCache: Map<string, string> = new Map();
  private logger: Logger;

  constructor(agentsDir: string, logger?: Logger) {
    this.agentsDir = agentsDir;
    this.logger = logger ?? pino({ level: "silent" });
  }

  close(): void {
    for (const db of this.connections.values()) {
      db.close();
    }
    this.connections.clear();
  }

  closeAgent(agentId: string): void {
    const db = this.connections.get(agentId);
    if (db) {
      db.close();
      this.connections.delete(agentId);
    }
    this.dirCache.delete(agentId);
  }

  private findAgentDir(agentId: string): string | null {
    const cached = this.dirCache.get(agentId);
    if (cached) return cached;

    let entries: string[];
    try {
      entries = fs.readdirSync(this.agentsDir);
    } catch {
      return null;
    }

    for (const entry of entries) {
      const candidatePath = path.join(this.agentsDir, entry);
      const stat = fs.statSync(candidatePath);
      if (!stat.isDirectory()) continue;

      const profilePath = path.join(candidatePath, "profile.md");
      try {
        const raw = fs.readFileSync(profilePath, "utf-8");
        const { data } = matter(raw);
        if (data.id === agentId) {
          this.dirCache.set(agentId, candidatePath);
          return candidatePath;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private getDb(agentId: string): Database.Database {
    const existing = this.connections.get(agentId);
    if (existing) return existing;

    const agentDir = this.findAgentDir(agentId);
    if (!agentDir) {
      throw new Error(`agent directory not found for agent "${agentId}"`);
    }

    const dbPath = path.join(agentDir, "sessions.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    this.applyMigrations(db);
    this.connections.set(agentId, db);
    this.logger.info({ agentId, dbPath }, "session db opened for agent");
    return db;
  }

  private applyMigrations(db: Database.Database): void {
    db.exec(MIGRATION);
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as any[];
    if (!cols.some((c: any) => c.name === "source")) {
      db.exec("ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'manual'");
    }
  }

  createSession(agentId: string, title?: string, source?: string): string {
    const db = this.getDb(agentId);
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status, source) VALUES (?, ?, ?, ?, ?, 'active', ?)",
    ).run(id, agentId, title ?? null, now, now, source ?? "manual");
    this.logger.info({ sessionId: id, agentId }, "session created in store");
    return id;
  }

  getSession(agentId: string, id: string): SessionInfo | null {
    const db = this.getDb(agentId);
    const row = db
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

  listSessions(agentId: string): SessionInfo[] {
    const db = this.getDb(agentId);
    const rows = db
      .prepare(
        "SELECT * FROM sessions WHERE agent_id = ? AND status = 'active' ORDER BY updated_at DESC",
      )
      .all(agentId) as any[];
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

  archiveSession(agentId: string, sessionId: string): void {
    const db = this.getDb(agentId);
    db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?").run(sessionId);
  }

  appendMessage(agentId: string, sessionId: string, message: any): void {
    const db = this.getDb(agentId);
    const now = Date.now();
    const insertMessage = db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
    );
    const updateSession = db.prepare(
      "UPDATE sessions SET updated_at = ? WHERE id = ?",
    );
    db.transaction(() => {
      insertMessage.run(sessionId, message.role, JSON.stringify(message), message.timestamp ?? now);
      updateSession.run(now, sessionId);
    })();
    this.logger.debug({ sessionId }, "message persisted");
  }

  getSessionMessages(agentId: string, sessionId: string): any[] {
    const db = this.getDb(agentId);
    const rows = db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC")
      .all(sessionId) as any[];
    return rows.map((row) => JSON.parse(row.content));
  }

  updateSessionTitle(agentId: string, sessionId: string, title: string): void {
    const db = this.getDb(agentId);
    db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, sessionId);
  }
}
