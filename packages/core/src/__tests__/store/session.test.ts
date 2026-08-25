import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
} from "@earendil-works/pi-ai";
import { SessionStore } from "../../store/session.js";

function userMsg(text: string, timestamp = 1000): UserMessage {
  return { role: "user", content: text, timestamp };
}

function asstMsg(text: string, timestamp = 2000): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

function toolResultMsg(text: string, timestamp = 3000): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "tc-1",
    toolName: "test",
    content: [{ type: "text", text }],
    isError: false,
    timestamp,
  };
}

function textOf(msg: AgentMessage): string {
  if (msg.role === "user") {
    return typeof msg.content === "string" ? msg.content : "";
  }
  if (msg.role === "assistant" || msg.role === "toolResult") {
    const block = (msg.content as TextContent[])[0];
    return block?.text ?? "";
  }
  return "";
}

describe("SessionStore", () => {
  let store: SessionStore;
  let tmpDir: string;
  let dbPath: string;
  const agentId = "agent-1";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-session-"));
    dbPath = path.join(tmpDir, "sessions.db");
    store = new SessionStore(dbPath, agentId);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const insertMessage = (sessionId: string, message: AgentMessage): number => {
    const db = new Database(dbPath);
    const result = db
      .prepare(
        "INSERT INTO messages (session_id, role, content, timestamp, prev_message_id, message_content_schema_version) VALUES (?, ?, ?, ?, NULL, 1)",
      )
      .run(sessionId, message.role, JSON.stringify(message), Date.now());
    db.close();
    return Number(result.lastInsertRowid);
  };

  it("creates and retrieves a session", () => {
    const id = store.createSession("Test Session");
    const session = store.getSession(id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(session!.agentId).toBe(agentId);
    expect(session!.title).toBe("Test Session");
    expect(session!.status).toBe("active");
  });

  it("creates session without title", () => {
    const id = store.createSession();
    const session = store.getSession(id);
    expect(session!.title).toBeUndefined();
  });

  it("returns null for non-existent session", () => {
    expect(store.getSession("no-such-id")).toBeNull();
  });

  it("lists sessions", () => {
    store.createSession("First");
    store.createSession("Second");
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it("archives a session", () => {
    const id = store.createSession("To Archive");
    store.archiveSession(id);
    const session = store.getSession(id);
    expect(session!.status).toBe("archived");
    const active = store.listSessions();
    expect(active).toHaveLength(0);
  });

  it("reads legacy messages", () => {
    const id = store.createSession();
    insertMessage(id, userMsg("hello", 1000));
    insertMessage(id, asstMsg("world", 2000));
    const messages = store.getSessionMessages(id);
    expect(messages).toHaveLength(2);
    expect(textOf(messages[0])).toBe("hello");
    expect(textOf(messages[1])).toBe("world");
  });

  it("updates session title", () => {
    const id = store.createSession("Old Title");
    store.updateSessionTitle(id, "New Title");
    const session = store.getSession(id);
    expect(session!.title).toBe("New Title");
  });

  describe("listSessionsPage", () => {
    const insertSession = (id: string, updatedAt: number): void => {
      const db = new Database(dbPath);
      db.prepare(
        "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status, source) VALUES (?, ?, NULL, ?, ?, 'active', 'manual')",
      ).run(id, agentId, updatedAt, updatedAt);
      db.close();
    };

    it("returns the first page and reports hasMore when more exist", () => {
      for (let i = 0; i < 12; i++) {
        insertSession(`s-${i}`, 1000 + i);
      }
      const page = store.listSessionsPage(10, 0);
      expect(page.items).toHaveLength(10);
      expect(page.hasMore).toBe(true);
      expect(page.items[0].id).toBe("s-11");
    });

    it("returns remaining items with hasMore false on the last page", () => {
      for (let i = 0; i < 12; i++) {
        insertSession(`s-${i}`, 1000 + i);
      }
      const page = store.listSessionsPage(10, 10);
      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(false);
      expect(page.items[0].id).toBe("s-1");
    });

    it("returns empty page with hasMore false when offset exceeds total", () => {
      insertSession("s-0", 1000);
      const page = store.listSessionsPage(10, 10);
      expect(page.items).toHaveLength(0);
      expect(page.hasMore).toBe(false);
    });

    it("reports hasMore false when the page is exactly filled", () => {
      for (let i = 0; i < 10; i++) {
        insertSession(`s-${i}`, 1000 + i);
      }
      const page = store.listSessionsPage(10, 0);
      expect(page.items).toHaveLength(10);
      expect(page.hasMore).toBe(false);
    });

    it("uses id DESC tiebreaker so equal updated_at rows never skip or duplicate across pages", () => {
      const sameTs = 5000;
      const allIds: string[] = [];
      for (let i = 0; i < 12; i++) {
        insertSession(`s-${i}`, sameTs);
        allIds.push(`s-${i}`);
      }
      const expectedOrder = [...allIds].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

      const page1 = store.listSessionsPage(10, 0);
      const page2 = store.listSessionsPage(10, 10);
      const page1Ids = page1.items.map((s) => s.id);
      const page2Ids = page2.items.map((s) => s.id);

      expect(page1.items).toHaveLength(10);
      expect(page1.hasMore).toBe(true);
      expect(page2.items).toHaveLength(2);
      expect(page2.hasMore).toBe(false);

      expect(page1Ids).toEqual(expectedOrder.slice(0, 10));
      expect(page2Ids).toEqual(expectedOrder.slice(10));

      const combined = [...page1Ids, ...page2Ids];
      expect(new Set(combined).size).toBe(12);
    });

    it("excludes archived sessions", () => {
      insertSession("s-active", 1000);
      insertSession("s-archived", 2000);
      store.archiveSession("s-archived");
      const page = store.listSessionsPage(10, 0);
      expect(page.items.map((s) => s.id)).toEqual(["s-active"]);
      expect(page.hasMore).toBe(false);
    });

    it("maps rows to SessionInfo like listSessions", () => {
      insertSession("s-1", 1000);
      const page = store.listSessionsPage(10, 0);
      expect(page.items[0]).toMatchObject({
        id: "s-1",
        agentId,
        status: "active",
        source: "manual",
      });
    });
  });

  describe("getRecentMessages (legacy read path)", () => {
    const insertTurn = (sessionId: string, userText: string, assistantCount = 1): void => {
      insertMessage(sessionId, userMsg(userText));
      for (let i = 0; i < assistantCount; i++) {
        insertMessage(sessionId, asstMsg(`${userText}-reply-${i}`));
      }
    };

    const getMessageIds = (sessionId: string): number[] => {
      const db = new Database(dbPath, { readonly: true });
      const rows = db
        .prepare("SELECT id FROM messages WHERE session_id = ? ORDER BY id ASC")
        .all(sessionId) as { id: number }[];
      db.close();
      return rows.map((r) => r.id);
    };

    it("slices the last N messages in ASC order", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertTurn(id, "t2");
      insertTurn(id, "t3");

      const ids = getMessageIds(id);
      const result = store.getRecentMessages(id, 3);
      expect(result.messages).toHaveLength(3);
      expect(textOf(result.messages[0])).toBe("t2-reply-0");
      expect(textOf(result.messages[1])).toBe("t3");
      expect(textOf(result.messages[2])).toBe("t3-reply-0");
      expect(result.hasMore).toBe(true);
      expect(result.oldestId).toBe(ids[3]);
    });

    it("returns all messages when requesting more than exist", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertTurn(id, "t2");
      insertTurn(id, "t3");

      const result = store.getRecentMessages(id, 10);
      expect(result.messages).toHaveLength(6);
      expect(textOf(result.messages[0])).toBe("t1");
      expect(textOf(result.messages[5])).toBe("t3-reply-0");
      expect(result.hasMore).toBe(false);
    });

    it("returns empty for a session with no messages", () => {
      const id = store.createSession();
      const result = store.getRecentMessages(id, 5);
      expect(result.messages).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.oldestId).toBeNull();
    });

    it("returns empty when beforeId is before the first message", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertTurn(id, "t2");

      const result = store.getRecentMessages(id, 5, 0);
      expect(result.messages).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.oldestId).toBeNull();
    });

    it("respects beforeId cursor", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertTurn(id, "t2");
      insertTurn(id, "t3");
      insertTurn(id, "t4");
      insertTurn(id, "t5");

      const ids = getMessageIds(id);
      const result = store.getRecentMessages(id, 2, ids[4]);
      expect(result.messages).toHaveLength(2);
      expect(textOf(result.messages[0])).toBe("t2");
      expect(textOf(result.messages[1])).toBe("t2-reply-0");
      expect(result.hasMore).toBe(true);
      expect(result.oldestId).toBe(ids[2]);
    });

    it("reports hasMore false when all messages are consumed", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertTurn(id, "t2");
      insertTurn(id, "t3");

      const result = store.getRecentMessages(id, 6);
      expect(result.messages).toHaveLength(6);
      expect(result.hasMore).toBe(false);
    });

    it("extends the page head past orphan toolResults so pairing stays self-contained", () => {
      const id = store.createSession();
      insertMessage(id, userMsg("t1"));
      insertMessage(id, asstMsg("a1"));
      insertMessage(id, toolResultMsg("r1"));
      insertMessage(id, toolResultMsg("r2"));

      const ids = getMessageIds(id);
      const result = store.getRecentMessages(id, 2);
      expect(result.messages.map((m) => m.role)).toEqual([
        "assistant",
        "toolResult",
        "toolResult",
      ]);
      expect(result.hasMore).toBe(true);
      expect(result.oldestId).toBe(ids[1]);
    });

    it("stops extending and reports hasMore false when extension exhausts older messages", () => {
      const id = store.createSession();
      insertMessage(id, asstMsg("a1"));
      insertMessage(id, toolResultMsg("r1"));
      insertMessage(id, toolResultMsg("r2"));

      const result = store.getRecentMessages(id, 2);
      expect(result.messages.map((m) => m.role)).toEqual([
        "assistant",
        "toolResult",
        "toolResult",
      ]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("legacy reads with raw inserts", () => {
    it("getMessagesAfter returns rows after anchor", () => {
      const id = store.createSession();
      insertMessage(id, userMsg("one"));
      const anchor = insertMessage(id, asstMsg("two"));
      const m3 = insertMessage(id, userMsg("three"));
      const m4 = insertMessage(id, asstMsg("four"));

      const result = store.getMessagesAfter(id, anchor);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(m3);
      expect(textOf(result[0].message)).toBe("three");
      expect(result[1].id).toBe(m4);
      expect(textOf(result[1].message)).toBe("four");
    });

    it("getSessionMessagesWithIds returns id + message pairs", () => {
      const id = store.createSession();
      insertMessage(id, userMsg("one"));
      insertMessage(id, asstMsg("two"));

      const result = store.getSessionMessagesWithIds(id);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: expect.any(Number),
        message: expect.objectContaining({ role: "user", content: "one" }),
      });
      expect(result[1]).toEqual({
        id: expect.any(Number),
        message: expect.objectContaining({ role: "assistant" }),
      });
    });
  });

  describe("corrupt message handling", () => {
    const insertRawMessage = (sessionId: string, content: string): void => {
      const db = new Database(dbPath);
      db.prepare(
        "INSERT INTO messages (session_id, role, content, timestamp, prev_message_id, message_content_schema_version) VALUES (?, ?, ?, ?, NULL, 1)",
      ).run(sessionId, "user", content, Date.now());
      db.close();
    };

    it("throws when getSessionMessagesWithIds encounters a non-object payload", () => {
      const id = store.createSession();
      insertRawMessage(id, JSON.stringify("not-an-object"));
      expect(() => store.getSessionMessagesWithIds(id)).toThrow(/Corrupt message/);
    });

    it("throws when getMessagesAfter encounters a payload without a known role", () => {
      const id = store.createSession();
      insertMessage(id, userMsg("ok"));
      const anchor = insertMessage(id, asstMsg("anchor"));
      insertRawMessage(id, JSON.stringify({ foo: "bar" }));
      expect(() => store.getMessagesAfter(id, anchor)).toThrow(/Corrupt message/);
    });

    it("throws when getRecentMessages encounters a payload without a known role", () => {
      const id = store.createSession();
      insertRawMessage(id, JSON.stringify({ role: "weird", content: "x" }));
      expect(() => store.getRecentMessages(id, 5)).toThrow(/Corrupt message/);
    });
  });

  describe("message_content_schema_version", () => {
    const insertRawMessage = (sessionId: string, content: string, version: number): number => {
      const db = new Database(dbPath);
      const result = db
        .prepare(
          "INSERT INTO messages (session_id, role, content, timestamp, prev_message_id, message_content_schema_version) VALUES (?, ?, ?, ?, NULL, ?)",
        )
        .run(sessionId, "user", content, Date.now(), version);
      db.close();
      return Number(result.lastInsertRowid);
    };

    it("reads v1 messages transparently", () => {
      const id = store.createSession();
      insertMessage(id, userMsg("hello", 1));
      const result = store.getSessionMessagesWithIds(id);
      expect(result[0].message).toMatchObject({ role: "user", content: "hello" });
    });

    it("refuses to read a message with a future schema version", () => {
      const id = store.createSession();
      insertRawMessage(
        id,
        JSON.stringify({ role: "user", content: "from the future" }),
        999,
      );
      expect(() => store.getSessionMessagesWithIds(id)).toThrow(
        /schema_version=999.*up to 1.*upgrade/i,
      );
    });
  });

  describe("migration: message_content_schema_version column", () => {
    it("adds the column with default 1 to an existing DB lacking it, and existing rows stay readable", () => {
      store.close();

      const legacyDbPath = path.join(tmpDir, "legacy.db");
      const legacySessionId = "legacy-session";
      const legacyMessage = userMsg("written-by-old-code", 12345);

      const legacy = new Database(legacyDbPath);
      legacy.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          title TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          status TEXT DEFAULT 'active',
          source TEXT DEFAULT 'manual'
        );
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          prev_message_id INTEGER
        );
        CREATE TABLE compactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          anchor_message_id INTEGER NOT NULL,
          digest_content TEXT NOT NULL,
          token_estimate INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      legacy
        .prepare(
          "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status, source) VALUES (?, ?, NULL, ?, ?, 'active', 'manual')",
        )
        .run(legacySessionId, agentId, 1, 1);
      legacy
        .prepare(
          "INSERT INTO messages (session_id, role, content, timestamp, prev_message_id) VALUES (?, ?, ?, ?, NULL)",
        )
        .run(legacySessionId, "user", JSON.stringify(legacyMessage), 12345);
      const legacyRowId = legacy
        .prepare("SELECT id FROM messages WHERE session_id = ?")
        .get(legacySessionId) as { id: number };
      legacy.close();

      const colsBefore = new Database(legacyDbPath, { readonly: true })
        .prepare("PRAGMA table_info(messages)")
        .all() as Array<{ name: string }>;
      expect(colsBefore.map((c) => c.name)).not.toContain("message_content_schema_version");

      const migrated = new SessionStore(legacyDbPath, agentId);
      try {
        const messages = migrated.getSessionMessages(legacySessionId);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual(legacyMessage);

        const versionRow = new Database(legacyDbPath, { readonly: true })
          .prepare("SELECT message_content_schema_version FROM messages WHERE id = ?")
          .get(legacyRowId.id) as { message_content_schema_version: number };
        expect(versionRow.message_content_schema_version).toBe(1);
      } finally {
        migrated.close();
      }
    });
  });
});
