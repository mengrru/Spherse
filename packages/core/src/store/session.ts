import Database from "better-sqlite3";
import type { SessionInfo } from "../types.js";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
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
  private db: Database.Database | null = null;

  async init(dbPath: string): Promise<void> {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(MIGRATION);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  createSession(agentId: string, title?: string): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db!
      .prepare(
        "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, 'active')",
      )
      .run(id, agentId, title ?? null, now, now);
    return id;
  }

  getSession(id: string): SessionInfo | null {
    const row = this.db!
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
    };
  }

  listSessions(agentId?: string): SessionInfo[] {
    const query = agentId
      ? "SELECT * FROM sessions WHERE agent_id = ? AND status = 'active' ORDER BY updated_at DESC"
      : "SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC";
    const rows = agentId
      ? (this.db!.prepare(query).all(agentId) as any[])
      : (this.db!.prepare(query).all() as any[]);
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
    }));
  }

  archiveByAgentId(agentId: string): void {
    this.db!
      .prepare("UPDATE sessions SET status = 'archived' WHERE agent_id = ?")
      .run(agentId);
  }

  archiveSession(sessionId: string): void {
    this.db!
      .prepare("UPDATE sessions SET status = 'archived' WHERE id = ?")
      .run(sessionId);
  }

  appendMessage(sessionId: string, message: any): void {
    const now = Date.now();
    this.db!
      .prepare(
        "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
      )
      .run(sessionId, message.role, JSON.stringify(message), message.timestamp ?? now);
    this.db!
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run(now, sessionId);
  }

  getSessionMessages(sessionId: string): any[] {
    const rows = this.db!
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
      )
      .all(sessionId) as any[];
    return rows.map((row) => JSON.parse(row.content));
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.db!
      .prepare("UPDATE sessions SET title = ? WHERE id = ?")
      .run(title, sessionId);
  }
}
