import Database from "better-sqlite3";
import crypto from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionInfo } from "../types.js";
import { type Logger, createSilentLogger } from "../logger.js";

interface PragmaColumnInfo {
  name: string;
}

interface SessionRow {
  id: string;
  agent_id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  status: string;
  source: string | null;
}

interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
  prev_message_id: number | null;
  message_content_schema_version: number;
}

interface CompactionRow {
  id: number;
  session_id: string;
  anchor_message_id: number;
  digest_content: string;
  token_estimate: number;
  created_at: number;
}

interface LastIdRow {
  lastId: number | null;
}

interface MaxIdRow {
  maxId: number | null;
}

type MessageWithId = { id: number; message: AgentMessage };

const CURRENT_MESSAGE_CONTENT_VERSION = 1;

const KNOWN_MESSAGE_ROLES = new Set([
  "user",
  "assistant",
  "toolResult",
  "bashExecution",
  "custom",
  "branchSummary",
  "compactionSummary",
]);

function isAgentMessage(v: unknown): v is AgentMessage {
  if (typeof v !== "object" || v === null) return false;
  const role = (v as { role?: unknown }).role;
  return typeof role === "string" && KNOWN_MESSAGE_ROLES.has(role);
}

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
  timestamp INTEGER NOT NULL,
  message_content_schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  anchor_message_id INTEGER NOT NULL,
  digest_content TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  created_at INTEGER NOT NULL
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
    const cols = this.db.prepare<[], PragmaColumnInfo>("PRAGMA table_info(sessions)").all();
    if (!cols.some((c) => c.name === "source")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'manual'");
    }
    const msgCols = this.db.prepare<[], PragmaColumnInfo>("PRAGMA table_info(messages)").all();
    if (!msgCols.some((c) => c.name === "prev_message_id")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN prev_message_id INTEGER");
    }
    if (!msgCols.some((c) => c.name === "message_content_schema_version")) {
      this.db.exec(
        "ALTER TABLE messages ADD COLUMN message_content_schema_version INTEGER NOT NULL DEFAULT 1",
      );
    }
  }

  createSession(title?: string, source?: string): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db
      .prepare<[string, string, string | null, number, number, string]>(
        "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status, source) VALUES (?, ?, ?, ?, ?, 'active', ?)",
      )
      .run(id, this.agentId, title ?? null, now, now, source ?? "manual");
    this.logger.info({ sessionId: id, agentId: this.agentId }, "session created in store");
    return id;
  }

  getSession(id: string): SessionInfo | null {
    const row = this.db
      .prepare<[string], SessionRow>("SELECT * FROM sessions WHERE id = ?")
      .get(id);
    return row ? SessionStore.rowToSessionInfo(row) : null;
  }

  listSessions(): SessionInfo[] {
    const rows = this.db
      .prepare<[string], SessionRow>(
        "SELECT * FROM sessions WHERE agent_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC",
      )
      .all(this.agentId);
    return rows.map((row) => SessionStore.rowToSessionInfo(row));
  }

  listSessionsPage(limit: number, offset: number): { items: SessionInfo[]; hasMore: boolean } {
    const rows = this.db
      .prepare<[string, number, number], SessionRow>(
        "SELECT * FROM sessions WHERE agent_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
      )
      .all(this.agentId, limit + 1, offset);
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map((row) => SessionStore.rowToSessionInfo(row));
    return { items, hasMore };
  }

  private static rowToSessionInfo(row: SessionRow): SessionInfo {
    return {
      id: row.id,
      agentId: row.agent_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status as SessionInfo["status"],
      source: (row.source ?? "manual") as SessionInfo["source"],
    };
  }

  archiveSession(sessionId: string): void {
    this.db
      .prepare<[string]>("UPDATE sessions SET status = 'archived' WHERE id = ?")
      .run(sessionId);
  }

  appendMessage(sessionId: string, message: AgentMessage, prevMessageId?: number | null): number {
    if (!isAgentMessage(message)) {
      throw new Error(
        `appendMessage rejected invalid AgentMessage (role=${JSON.stringify((message as { role?: unknown }).role)})`,
      );
    }
    const now = Date.now();
    const insertMessage = this.db
      .prepare<[string, string, string, number, number | null, number]>(
        "INSERT INTO messages (session_id, role, content, timestamp, prev_message_id, message_content_schema_version) VALUES (?, ?, ?, ?, ?, ?)",
      );
    const updateSession = this.db
      .prepare<[number, string]>("UPDATE sessions SET updated_at = ? WHERE id = ?");
    const selectLastId = this.db
      .prepare<[string], LastIdRow>("SELECT MAX(id) AS lastId FROM messages WHERE session_id = ?");
    const info = this.db.transaction(() => {
      const resolvedPrev: number | null =
        prevMessageId === undefined
          ? (selectLastId.get(sessionId)?.lastId ?? null)
          : prevMessageId;
      const result = insertMessage.run(
        sessionId,
        message.role,
        JSON.stringify(message),
        typeof message.timestamp === "number" ? message.timestamp : now,
        resolvedPrev,
        CURRENT_MESSAGE_CONTENT_VERSION,
      );
      updateSession.run(now, sessionId);
      return result;
    })();
    this.logger.debug({ sessionId }, "message persisted");
    return Number(info.lastInsertRowid);
  }

  getSessionMessages(sessionId: string): AgentMessage[] {
    return this.getSessionMessagesWithIds(sessionId).map((r) => r.message);
  }

  getSessionMessagesWithIds(sessionId: string): MessageWithId[] {
    const rows = this.db
      .prepare<[string], MessageRow>(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC",
      )
      .all(sessionId);
    return rows.map((row) => SessionStore.rowToMessageEntry(row));
  }

  getMessagesAfter(sessionId: string, anchorId: number): MessageWithId[] {
    const rows = this.db
      .prepare<[string, number], MessageRow>(
        "SELECT * FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC",
      )
      .all(sessionId, anchorId);
    return rows.map((row) => SessionStore.rowToMessageEntry(row));
  }

  recordCompaction(
    sessionId: string,
    record: { anchorMessageId: number; digestContent: string; tokenEstimate: number },
  ): void {
    const now = Date.now();
    this.db
      .prepare<[string, number, string, number, number]>(
        "INSERT INTO compactions (session_id, anchor_message_id, digest_content, token_estimate, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(sessionId, record.anchorMessageId, record.digestContent, record.tokenEstimate, now);
    this.logger.debug({ sessionId, anchorMessageId: record.anchorMessageId }, "compaction recorded");
  }

  getLatestCompaction(
    sessionId: string,
  ): {
    id: number;
    anchorMessageId: number;
    digestContent: string;
    tokenEstimate: number;
    createdAt: number;
  } | null {
    const row = this.db
      .prepare<[string], CompactionRow>(
        "SELECT * FROM compactions WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get(sessionId);
    if (!row) return null;
    return {
      id: row.id,
      anchorMessageId: row.anchor_message_id,
      digestContent: row.digest_content,
      tokenEstimate: row.token_estimate,
      createdAt: row.created_at,
    };
  }

  getRecentTurns(
    sessionId: string,
    turns: number,
    beforeId?: number,
  ): { messages: AgentMessage[]; hasMore: boolean; oldestId: number | null } {
    let cursor: number;
    if (beforeId !== undefined) {
      cursor = beforeId;
    } else {
      const maxRow = this.db
        .prepare<[string], MaxIdRow>("SELECT MAX(id) AS maxId FROM messages WHERE session_id = ?")
        .get(sessionId);
      if (!maxRow || maxRow.maxId === null) {
        return { messages: [], hasMore: false, oldestId: null };
      }
      cursor = maxRow.maxId + 1;
    }

    const rows = this.db
      .prepare<[string, number], MessageRow>(
        "SELECT * FROM messages WHERE session_id = ? AND id < ? ORDER BY id DESC",
      )
      .all(sessionId, cursor);

    if (rows.length === 0) {
      return { messages: [], hasMore: false, oldestId: null };
    }

    const collected: MessageWithId[] = [];
    let turnCount = 0;
    for (const row of rows) {
      const msg = SessionStore.parseMessage(
        row.content,
        row.id,
        row.message_content_schema_version,
      );
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
    this.db
      .prepare<[string, string]>("UPDATE sessions SET title = ? WHERE id = ?")
      .run(title, sessionId);
  }

  close(): void {
    this.db.close();
  }

  private static rowToMessageEntry(row: MessageRow): MessageWithId {
    return {
      id: row.id,
      message: SessionStore.parseMessage(
        row.content,
        row.id,
        row.message_content_schema_version,
      ),
    };
  }

  private static parseMessage(
    content: string,
    rowId: number,
    schemaVersion: number,
  ): AgentMessage {
    const parsed: unknown = JSON.parse(content);
    const adapted =
      schemaVersion === CURRENT_MESSAGE_CONTENT_VERSION
        ? parsed
        : adaptMessageContent(parsed, schemaVersion);
    if (!isAgentMessage(adapted)) {
      throw new Error(
        `Corrupt message at messages.id=${rowId} (schema_version=${schemaVersion}): expected {role, ...} got ${JSON.stringify(parsed).slice(0, 200)}`,
      );
    }
    return adapted;
  }
}

function adaptMessageContent(parsed: unknown, fromVersion: number): unknown {
  if (fromVersion > CURRENT_MESSAGE_CONTENT_VERSION) {
    throw new Error(
      `Cannot read message with schema_version=${fromVersion}; current code supports up to ${CURRENT_MESSAGE_CONTENT_VERSION}. Please upgrade the app.`,
    );
  }
  return parsed;
}
