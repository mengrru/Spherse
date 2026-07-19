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

  it("appends and retrieves messages", () => {
    const id = store.createSession();
    store.appendMessage(id, userMsg("hello", 1000));
    store.appendMessage(id, asstMsg("world", 2000));
    const messages = store.getSessionMessages(id);
    expect(messages).toHaveLength(2);
    expect(textOf(messages[0])).toBe("hello");
    expect(textOf(messages[1])).toBe("world");
  });

  it("updates session updated_at on message append", () => {
    const id = store.createSession();
    const before = store.getSession(id)!.updatedAt;
    store.appendMessage(id, userMsg("hi", Date.now()));
    const after = store.getSession(id)!.updatedAt;
    expect(after).toBeGreaterThanOrEqual(before);
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

  describe("getRecentTurns", () => {
    const insertTurn = (sessionId: string, userText: string, assistantCount = 1): void => {
      store.appendMessage(sessionId, userMsg(userText));
      for (let i = 0; i < assistantCount; i++) {
        store.appendMessage(sessionId, asstMsg(`${userText}-reply-${i}`));
      }
    };

    const insertMultiMessageTurn = (sessionId: string, userText: string): void => {
      store.appendMessage(sessionId, userMsg(userText));
      store.appendMessage(sessionId, asstMsg(`${userText}-reply-0`));
      store.appendMessage(sessionId, asstMsg(`${userText}-reply-1`));
      store.appendMessage(sessionId, toolResultMsg(`${userText}-tool`));
    };

    const getMessageIds = (sessionId: string): number[] => {
      const db = new Database(dbPath, { readonly: true });
      const rows = db
        .prepare("SELECT id FROM messages WHERE session_id = ? ORDER BY id ASC")
        .all(sessionId) as { id: number }[];
      db.close();
      return rows.map((r) => r.id);
    };

    it("slices the last N turns in ASC order", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertTurn(id, "t2");
      insertTurn(id, "t3");

      const ids = getMessageIds(id);
      const result = store.getRecentTurns(id, 2);
      expect(result.messages).toHaveLength(4);
      expect(textOf(result.messages[0])).toBe("t2");
      expect(textOf(result.messages[1])).toBe("t2-reply-0");
      expect(textOf(result.messages[2])).toBe("t3");
      expect(textOf(result.messages[3])).toBe("t3-reply-0");
      expect(result.hasMore).toBe(true);
      expect(result.oldestId).toBe(ids[2]);
    });

    it("returns all turns when requesting more than exist", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertTurn(id, "t2");
      insertTurn(id, "t3");

      const result = store.getRecentTurns(id, 10);
      expect(result.messages).toHaveLength(6);
      expect(textOf(result.messages[0])).toBe("t1");
      expect(textOf(result.messages[5])).toBe("t3-reply-0");
      expect(result.hasMore).toBe(false);
    });

    it("returns empty for a session with no messages", () => {
      const id = store.createSession();
      const result = store.getRecentTurns(id, 5);
      expect(result.messages).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.oldestId).toBeNull();
    });

    it("returns empty when beforeId is before the first message", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertTurn(id, "t2");

      const result = store.getRecentTurns(id, 5, 0);
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
      const turn4FirstId = ids[6];

      const result = store.getRecentTurns(id, 2, turn4FirstId);
      expect(result.messages).toHaveLength(4);
      expect(textOf(result.messages[0])).toBe("t2");
      expect(textOf(result.messages[1])).toBe("t2-reply-0");
      expect(textOf(result.messages[2])).toBe("t3");
      expect(textOf(result.messages[3])).toBe("t3-reply-0");
      expect(result.hasMore).toBe(true);
      expect(result.oldestId).toBe(ids[2]);
    });

    it("reports hasMore false when all turns are consumed", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertTurn(id, "t2");
      insertTurn(id, "t3");

      const result = store.getRecentTurns(id, 3);
      expect(result.messages).toHaveLength(6);
      expect(result.hasMore).toBe(false);
    });

    it("treats a multi-message turn as a single turn", () => {
      const id = store.createSession();
      insertTurn(id, "t1");
      insertMultiMessageTurn(id, "t2");

      const result = store.getRecentTurns(id, 1);
      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].role).toBe("user");
      expect(textOf(result.messages[0])).toBe("t2");
      expect(result.messages[1].role).toBe("assistant");
      expect(result.messages[2].role).toBe("assistant");
      expect(result.messages[3].role).toBe("toolResult");
      expect(result.hasMore).toBe(true);
    });
  });

  describe("prev_message_id support", () => {
    const getPrevMessageId = (messageId: number): number | null => {
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare("SELECT prev_message_id FROM messages WHERE id = ?")
        .get(messageId) as { prev_message_id: number | null } | undefined;
      db.close();
      return row ? row.prev_message_id : null;
    };

    it("appendMessage returns a numeric row id", () => {
      const id = store.createSession();
      const rowId = store.appendMessage(id, userMsg("hello"));
      expect(typeof rowId).toBe("number");
      expect(rowId).toBeGreaterThan(0);
    });

    it("appendMessage with prevMessageId stores it correctly", () => {
      const id = store.createSession();
      const firstId = store.appendMessage(id, userMsg("first"));
      const secondId = store.appendMessage(id, asstMsg("second"), firstId);
      expect(getPrevMessageId(secondId)).toBe(firstId);
    });

    it("appendMessage without prevMessageId stores NULL for the first message", () => {
      const id = store.createSession();
      const rowId = store.appendMessage(id, userMsg("hello"));
      expect(getPrevMessageId(rowId)).toBeNull();
    });

    it("appendMessage auto-chains prev_message_id to the last message when not provided", () => {
      const id = store.createSession();
      const firstId = store.appendMessage(id, userMsg("first"));
      const secondId = store.appendMessage(id, asstMsg("second"));
      const thirdId = store.appendMessage(id, userMsg("third"));
      expect(getPrevMessageId(secondId)).toBe(firstId);
      expect(getPrevMessageId(thirdId)).toBe(secondId);
    });

    it("appendMessage auto-chain is scoped per session", () => {
      const a = store.createSession();
      const b = store.createSession();
      const a1 = store.appendMessage(a, userMsg("a1"));
      const b1 = store.appendMessage(b, userMsg("b1"));
      const a2 = store.appendMessage(a, userMsg("a2"));
      expect(getPrevMessageId(b1)).toBeNull();
      expect(getPrevMessageId(a2)).toBe(a1);
    });
  });

  describe("compactions", () => {
    it("recordCompaction + getLatestCompaction returns the recorded record with correct fields", () => {
      const id = store.createSession();
      store.recordCompaction(id, {
        anchorMessageId: 42,
        digestContent: "digest-payload",
        tokenEstimate: 1024,
      });
      const latest = store.getLatestCompaction(id);
      expect(latest).not.toBeNull();
      expect(latest!.anchorMessageId).toBe(42);
      expect(latest!.digestContent).toBe("digest-payload");
      expect(latest!.tokenEstimate).toBe(1024);
      expect(typeof latest!.id).toBe("number");
      expect(typeof latest!.createdAt).toBe("number");
    });

    it("getLatestCompaction returns null for session with no compactions", () => {
      const id = store.createSession();
      expect(store.getLatestCompaction(id)).toBeNull();
    });

    it("getLatestCompaction returns the most recent when multiple compactions exist", () => {
      const id = store.createSession();
      store.recordCompaction(id, {
        anchorMessageId: 1,
        digestContent: "first",
        tokenEstimate: 10,
      });
      store.recordCompaction(id, {
        anchorMessageId: 5,
        digestContent: "second",
        tokenEstimate: 20,
      });
      const latest = store.getLatestCompaction(id);
      expect(latest).not.toBeNull();
      expect(latest!.digestContent).toBe("second");
      expect(latest!.anchorMessageId).toBe(5);
      expect(latest!.tokenEstimate).toBe(20);
    });
  });

  describe("getMessagesAfter", () => {
    it("Returns messages with id > anchorId in ascending order", () => {
      const id = store.createSession();
      store.appendMessage(id, userMsg("one"));
      const anchor = store.appendMessage(id, asstMsg("two"));
      const m3 = store.appendMessage(id, userMsg("three"));
      const m4 = store.appendMessage(id, asstMsg("four"));

      const result = store.getMessagesAfter(id, anchor);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(m3);
      expect(textOf(result[0].message)).toBe("three");
      expect(result[1].id).toBe(m4);
      expect(textOf(result[1].message)).toBe("four");
    });

    it("Returns empty array when no messages after anchorId", () => {
      const id = store.createSession();
      store.appendMessage(id, userMsg("one"));
      const anchor = store.appendMessage(id, asstMsg("two"));

      const result = store.getMessagesAfter(id, anchor);
      expect(result).toEqual([]);
    });

    it("Returns objects with both id and message fields", () => {
      const id = store.createSession();
      store.appendMessage(id, userMsg("one"));
      const anchor = store.appendMessage(id, asstMsg("two"));
      store.appendMessage(id, userMsg("three"));

      const result = store.getMessagesAfter(id, anchor);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: expect.any(Number),
        message: expect.objectContaining({ role: "user", content: "three" }),
      });
    });
  });

  describe("getSessionMessagesWithIds", () => {
    it("Returns objects with both id and message fields", () => {
      const id = store.createSession();
      store.appendMessage(id, userMsg("one"));
      store.appendMessage(id, asstMsg("two"));

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

    it("Returns same messages as getSessionMessages", () => {
      const id = store.createSession();
      const u = userMsg("one", 1000);
      const a = asstMsg("two", 2000);
      const u2 = userMsg("three", 3000);
      store.appendMessage(id, u);
      store.appendMessage(id, a);
      store.appendMessage(id, u2);

      const plain = store.getSessionMessages(id);
      const withIds = store.getSessionMessagesWithIds(id).map((r) => r.message);
      expect(withIds).toEqual(plain);
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
      store.appendMessage(id, userMsg("ok"));
      const anchor = store.appendMessage(id, asstMsg("anchor"));
      insertRawMessage(id, JSON.stringify({ foo: "bar" }));
      expect(() => store.getMessagesAfter(id, anchor)).toThrow(/Corrupt message/);
    });

    it("throws when getRecentTurns encounters a payload without a known role", () => {
      const id = store.createSession();
      insertRawMessage(id, JSON.stringify({ role: "weird", content: "x" }));
      expect(() => store.getRecentTurns(id, 5)).toThrow(/Corrupt message/);
    });

    it("appendMessage rejects an invalid AgentMessage at write time", () => {
      const id = store.createSession();
      expect(() =>
        store.appendMessage(id, { role: "totally-fake" } as unknown as AgentMessage),
      ).toThrow(/appendMessage rejected invalid AgentMessage/);
      expect(store.getSessionMessages(id)).toHaveLength(0);
    });
  });

  describe("message_content_schema_version", () => {
    const getSchemaVersion = (messageId: number): number => {
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare("SELECT message_content_schema_version FROM messages WHERE id = ?")
        .get(messageId) as { message_content_schema_version: number };
      db.close();
      return row.message_content_schema_version;
    };

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

    it("appendMessage writes the current schema version", () => {
      const id = store.createSession();
      const rowId = store.appendMessage(id, userMsg("v1"));
      expect(getSchemaVersion(rowId)).toBe(1);
    });

    it("reads v1 messages transparently", () => {
      const id = store.createSession();
      store.appendMessage(id, userMsg("hello", 1));
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

        const newRowId = migrated.appendMessage(legacySessionId, userMsg("after-migration"));
        const newRow = new Database(legacyDbPath, { readonly: true })
          .prepare("SELECT message_content_schema_version FROM messages WHERE id = ?")
          .get(newRowId) as { message_content_schema_version: number };
        expect(newRow.message_content_schema_version).toBe(1);
      } finally {
        migrated.close();
      }
    });
  });
});
