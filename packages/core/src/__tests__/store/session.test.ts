import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import { SessionStore } from "../../store/session.js";

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
    store.appendMessage(id, { role: "user", content: "hello", timestamp: 1000 });
    store.appendMessage(id, { role: "assistant", content: "world", timestamp: 2000 });
    const messages = store.getSessionMessages(id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("hello");
    expect(messages[1].content).toBe("world");
  });

  it("updates session updated_at on message append", () => {
    const id = store.createSession();
    const before = store.getSession(id)!.updatedAt;
    store.appendMessage(id, { role: "user", content: "hi", timestamp: Date.now() });
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
      // id is TEXT, so `id DESC` is lexicographic descending.
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
    const insertTurn = (sessionId: string, userContent: string, assistantCount = 1): void => {
      store.appendMessage(sessionId, { role: "user", content: userContent, timestamp: Date.now() });
      for (let i = 0; i < assistantCount; i++) {
        store.appendMessage(sessionId, { role: "assistant", content: `${userContent}-reply-${i}`, timestamp: Date.now() });
      }
    };

    const insertMultiMessageTurn = (sessionId: string, userContent: string): void => {
      store.appendMessage(sessionId, { role: "user", content: userContent, timestamp: Date.now() });
      store.appendMessage(sessionId, { role: "assistant", content: `${userContent}-reply-0`, timestamp: Date.now() });
      store.appendMessage(sessionId, { role: "assistant", content: `${userContent}-reply-1`, timestamp: Date.now() });
      store.appendMessage(sessionId, { role: "toolResult", content: `${userContent}-tool`, timestamp: Date.now() });
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
      expect(result.messages[0].content).toBe("t2");
      expect(result.messages[1].content).toBe("t2-reply-0");
      expect(result.messages[2].content).toBe("t3");
      expect(result.messages[3].content).toBe("t3-reply-0");
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
      expect(result.messages[0].content).toBe("t1");
      expect(result.messages[5].content).toBe("t3-reply-0");
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
      expect(result.messages[0].content).toBe("t2");
      expect(result.messages[1].content).toBe("t2-reply-0");
      expect(result.messages[2].content).toBe("t3");
      expect(result.messages[3].content).toBe("t3-reply-0");
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
      expect(result.messages[0].content).toBe("t2");
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
      const rowId = store.appendMessage(id, { role: "user", content: "hello" });
      expect(typeof rowId).toBe("number");
      expect(rowId).toBeGreaterThan(0);
    });

    it("appendMessage with prevMessageId stores it correctly", () => {
      const id = store.createSession();
      const firstId = store.appendMessage(id, { role: "user", content: "first" });
      const secondId = store.appendMessage(id, { role: "assistant", content: "second" }, firstId);
      expect(getPrevMessageId(secondId)).toBe(firstId);
    });

    it("appendMessage without prevMessageId stores NULL for the first message", () => {
      const id = store.createSession();
      const rowId = store.appendMessage(id, { role: "user", content: "hello" });
      expect(getPrevMessageId(rowId)).toBeNull();
    });

    it("appendMessage auto-chains prev_message_id to the last message when not provided", () => {
      const id = store.createSession();
      const firstId = store.appendMessage(id, { role: "user", content: "first" });
      const secondId = store.appendMessage(id, { role: "assistant", content: "second" });
      const thirdId = store.appendMessage(id, { role: "user", content: "third" });
      expect(getPrevMessageId(secondId)).toBe(firstId);
      expect(getPrevMessageId(thirdId)).toBe(secondId);
    });

    it("appendMessage auto-chain is scoped per session", () => {
      const a = store.createSession();
      const b = store.createSession();
      const a1 = store.appendMessage(a, { role: "user", content: "a1" });
      const b1 = store.appendMessage(b, { role: "user", content: "b1" });
      const a2 = store.appendMessage(a, { role: "user", content: "a2" });
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
      store.appendMessage(id, { role: "user", content: "one" });
      const anchor = store.appendMessage(id, { role: "assistant", content: "two" });
      const m3 = store.appendMessage(id, { role: "user", content: "three" });
      const m4 = store.appendMessage(id, { role: "assistant", content: "four" });

      const result = store.getMessagesAfter(id, anchor);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(m3);
      expect(result[0].message.content).toBe("three");
      expect(result[1].id).toBe(m4);
      expect(result[1].message.content).toBe("four");
    });

    it("Returns empty array when no messages after anchorId", () => {
      const id = store.createSession();
      store.appendMessage(id, { role: "user", content: "one" });
      const anchor = store.appendMessage(id, { role: "assistant", content: "two" });

      const result = store.getMessagesAfter(id, anchor);
      expect(result).toEqual([]);
    });

    it("Returns objects with both id and message fields", () => {
      const id = store.createSession();
      store.appendMessage(id, { role: "user", content: "one" });
      const anchor = store.appendMessage(id, { role: "assistant", content: "two" });
      store.appendMessage(id, { role: "user", content: "three" });

      const result = store.getMessagesAfter(id, anchor);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: expect.any(Number), message: expect.objectContaining({ content: "three" }) });
    });
  });

  describe("getSessionMessagesWithIds", () => {
    it("Returns objects with both id and message fields", () => {
      const id = store.createSession();
      store.appendMessage(id, { role: "user", content: "one" });
      store.appendMessage(id, { role: "assistant", content: "two" });

      const result = store.getSessionMessagesWithIds(id);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: expect.any(Number), message: expect.objectContaining({ role: "user", content: "one" }) });
      expect(result[1]).toEqual({ id: expect.any(Number), message: expect.objectContaining({ role: "assistant", content: "two" }) });
    });

    it("Returns same messages as getSessionMessages", () => {
      const id = store.createSession();
      store.appendMessage(id, { role: "user", content: "one", timestamp: 1000 });
      store.appendMessage(id, { role: "assistant", content: "two", timestamp: 2000 });
      store.appendMessage(id, { role: "user", content: "three", timestamp: 3000 });

      const plain = store.getSessionMessages(id);
      const withIds = store.getSessionMessagesWithIds(id).map((r) => r.message);
      expect(withIds).toEqual(plain);
    });
  });
});
