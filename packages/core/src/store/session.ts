import Database from "better-sqlite3";
import crypto from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionInfo } from "../types.js";
import type { SessionEvent } from "../session/events.js";
import { EVENT_SCHEMA_VERSION } from "../session/events.js";
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

interface EventRow {
  session_id: string;
  seq: number;
  type: string;
  data: string;
  time: number;
  schema_version: number;
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

CREATE TABLE IF NOT EXISTS events (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  time INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, seq)
);
`;

export class SessionStore {
  private agentId: string;
  private db: Database.Database;
  private logger: Logger;

  constructor(dbPath: string, agentId: string, logger?: Logger) {
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
    if (!cols.some((c) => c.name === "parent_session_id")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN parent_session_id TEXT");
    }
    if (!cols.some((c) => c.name === "fork_seq")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN fork_seq INTEGER");
    }
    if (!cols.some((c) => c.name === "migrated_at")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN migrated_at INTEGER");
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

  appendEvents(sessionId: string, events: ReadonlyArray<SessionEvent>, schemaVersion: number): void {
    if (events.length === 0) return;
    const insert = this.db.prepare<[string, number, string, string, number, number]>(
      "INSERT INTO events (session_id, seq, type, data, time, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const selectMax = this.db.prepare<[string], { maxSeq: number | null }>(
      "SELECT MAX(seq) AS maxSeq FROM events WHERE session_id = ?",
    );
    const updateSession = this.db
      .prepare<[number, string]>("UPDATE sessions SET updated_at = ? WHERE id = ?");
    const now = Date.now();
    this.db.transaction(() => {
      const expectedFirstSeq = (selectMax.get(sessionId)?.maxSeq ?? -1) + 1;
      if (events[0].seq !== expectedFirstSeq) {
        throw new Error(
          `Event seq must continue at ${expectedFirstSeq} for session ${sessionId}`,
        );
      }
      for (const [index, event] of events.entries()) {
        if (event.seq !== expectedFirstSeq + index) {
          throw new Error(`Event batch contains a seq gap for session ${sessionId}`);
        }
        insert.run(sessionId, event.seq, event.type, JSON.stringify(event.data), event.time, schemaVersion);
      }
      updateSession.run(now, sessionId);
    })();
    this.logger.debug({ sessionId, count: events.length }, "events appended");
  }

  readEvents(sessionId: string): SessionEvent[] {
    const rows = this.db
      .prepare<[string], EventRow>(
        "SELECT * FROM events WHERE session_id = ? ORDER BY seq ASC",
      )
      .all(sessionId);
    return SessionStore.rowsToEvents(rows);
  }

  readEventsAfter(sessionId: string, sinceSeq: number, limit: number): SessionEvent[] {
    const rows = this.db
      .prepare<[string, number, number], EventRow>(
        "SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
      )
      .all(sessionId, sinceSeq, limit);
    return SessionStore.rowsToEvents(rows);
  }

  readEventCount(sessionId: string): number {
    const row = this.db
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM events WHERE session_id = ?",
      )
      .get(sessionId);
    return row?.count ?? 0;
  }

  private static rowsToEvents(rows: EventRow[]): SessionEvent[] {
    return rows.map((row) => {
      assertSupportedEventVersion(row);
      return {
        type: row.type as SessionEvent["type"],
        seq: row.seq,
        time: row.time,
        data: JSON.parse(row.data),
      } as SessionEvent;
    });
  }

  maxSeq(sessionId: string): number | null {
    const row = this.db
      .prepare<[string], { maxSeq: number | null }>(
        "SELECT MAX(seq) AS maxSeq FROM events WHERE session_id = ?",
      )
      .get(sessionId);
    return row?.maxSeq ?? null;
  }

  migrateEvents(
    sessionId: string,
    events: ReadonlyArray<SessionEvent>,
    schemaVersion: number,
  ): void {
    if (events.some((event, index) => event.seq !== index)) {
      throw new Error(`Migration event batch contains a seq gap for session ${sessionId}`);
    }
    const insert = this.db.prepare<[string, number, string, string, number, number]>(
      "INSERT INTO events (session_id, seq, type, data, time, schema_version) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const mark = this.db.prepare<[number, number, string]>(
      "UPDATE sessions SET migrated_at = ?, updated_at = ? WHERE id = ?",
    );
    const now = Date.now();
    this.db.transaction(() => {
      const existing = this.db
        .prepare<[string], { count: number }>(
          "SELECT COUNT(*) AS count FROM events WHERE session_id = ?",
        )
        .get(sessionId);
      if ((existing?.count ?? 0) > 0) {
        throw new Error(`Session ${sessionId} already contains events`);
      }
      for (const event of events) {
        insert.run(
          sessionId,
          event.seq,
          event.type,
          JSON.stringify(event.data),
          event.time,
          schemaVersion,
        );
      }
      mark.run(now, now, sessionId);
    })();
  }

  isMigrated(sessionId: string): boolean {
    const row = this.db
      .prepare<[string], { migrated_at: number | null }>(
        "SELECT migrated_at FROM sessions WHERE id = ?",
      )
      .get(sessionId);
    return row?.migrated_at != null;
  }

  sessionNeedsMigration(sessionId: string): boolean {
    const row = this.db
      .prepare<[string], { migrated_at: number | null; eventCount: number }>(
        `SELECT s.migrated_at, (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS eventCount
         FROM sessions s WHERE s.id = ?`,
      )
      .get(sessionId);
    if (!row) return false;
    return row.migrated_at == null && row.eventCount === 0 && this.hasLegacyMessages(sessionId);
  }

  private hasLegacyMessages(sessionId: string): boolean {
    const row = this.db
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM messages WHERE session_id = ?",
      )
      .get(sessionId);
    return (row?.count ?? 0) > 0;
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

  getRecentMessages(
    sessionId: string,
    limit: number,
    beforeId?: number,
  ): {
    messages: AgentMessage[];
    entries: MessageWithId[];
    hasMore: boolean;
    oldestId: number | null;
  } {
    const effectiveLimit = Math.max(1, limit);
    let cursor: number;
    if (beforeId !== undefined) {
      cursor = beforeId;
    } else {
      const maxRow = this.db
        .prepare<[string], MaxIdRow>("SELECT MAX(id) AS maxId FROM messages WHERE session_id = ?")
        .get(sessionId);
      if (!maxRow || maxRow.maxId === null) {
        return { messages: [], entries: [], hasMore: false, oldestId: null };
      }
      cursor = maxRow.maxId + 1;
    }

    const rows = this.db
      .prepare<[string, number, number], MessageRow>(
        "SELECT * FROM messages WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
      )
      .all(sessionId, cursor, effectiveLimit);

    if (rows.length === 0) {
      return { messages: [], entries: [], hasMore: false, oldestId: null };
    }

    const collected: MessageWithId[] = rows.map((row) => ({
      id: row.id,
      message: SessionStore.parseMessage(row.content, row.id, row.message_content_schema_version),
    }));

    // role 埋在 content JSON 内，SQL 无法过滤：页首为孤儿 toolResult 时逐行向旧方向扩展，
    // 保证单页内 toolCall/toolResult 配对自洽（页可略超 limit）
    const olderRow = this.db
      .prepare<[string, number], MessageRow>(
        "SELECT * FROM messages WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT 1",
      );
    for (;;) {
      const oldest = collected[collected.length - 1];
      if (oldest.message.role !== "toolResult") break;
      const row = olderRow.get(sessionId, oldest.id);
      if (!row) break;
      collected.push({
        id: row.id,
        message: SessionStore.parseMessage(row.content, row.id, row.message_content_schema_version),
      });
    }

    const hasMoreRow = this.db
      .prepare<[string, number], { one: number }>(
        "SELECT 1 AS one FROM messages WHERE session_id = ? AND id < ? LIMIT 1",
      )
      .get(sessionId, collected[collected.length - 1].id);

    const oldestId = collected[collected.length - 1].id;
    const entries = collected.reverse();
    return {
      messages: entries.map((entry) => entry.message),
      entries,
      hasMore: hasMoreRow !== undefined,
      oldestId,
    };
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

function assertSupportedEventVersion(row: EventRow): void {
  if (row.schema_version > EVENT_SCHEMA_VERSION) {
    throw new Error(
      `Cannot read event with schema_version=${row.schema_version}; current code supports up to ${EVENT_SCHEMA_VERSION}. Please upgrade the app.`,
    );
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
