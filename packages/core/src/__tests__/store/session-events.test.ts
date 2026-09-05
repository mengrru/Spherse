import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionStore } from "../../store/session.js";
import { SessionEventLog } from "../../session/event-log.js";
import type { SessionEvent } from "../../session/events.js";

function legacyUserMsg(text: string, timestamp = 1000): AgentMessage {
  return { role: "user", content: text, timestamp } as AgentMessage;
}

function legacyAsstMsg(text: string, timestamp = 2000): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp,
  } as unknown as AgentMessage;
}

describe("SessionStore events", () => {
  let store: SessionStore;
  let tmpDir: string;
  let dbPath: string;
  const agentId = "agent-1";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-session-events-"));
    dbPath = path.join(tmpDir, "sessions.db");
    store = new SessionStore(dbPath, agentId);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const seedLegacySession = (): string => {
    const id = store.createSession("legacy");
    const db = new Database(dbPath);
    const insert = db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp, prev_message_id, message_content_schema_version) VALUES (?, ?, ?, ?, NULL, 1)",
    );
    insert.run(id, "user", JSON.stringify(legacyUserMsg("q1")), 1000);
    insert.run(id, "assistant", JSON.stringify(legacyAsstMsg("a1")), 2000);
    db.close();
    return id;
  };

  describe("appendEvents / readEvents / maxSeq", () => {
    it("round-trips events in seq order", () => {
      const id = store.createSession();
      const log = SessionEventLog.open(store, id);
      log.append("turn/start", {});
      log.append("user/message", { message: legacyUserMsg("hello") });
      log.append("turn/end", { reason: "completed" });

      const persisted = store.readEvents(id);
      expect(persisted.map((e) => [e.type, e.seq])).toEqual([
        ["turn/start", 0],
        ["user/message", 1],
        ["turn/end", 2],
      ]);
      expect((persisted[1].data as { message: AgentMessage }).message.content).toBe("hello");
      expect(store.maxSeq(id)).toBe(2);
    });

    it("rejects duplicate (session_id, seq) primary key", () => {
      const id = store.createSession();
      const event: SessionEvent = {
        type: "turn/start",
        seq: 0,
        time: 1,
        data: {},
      };
      store.appendEvents(id, [event], 1);
      expect(() => store.appendEvents(id, [event], 1)).toThrow(/must continue/);
    });

    it("rejects a batch with a seq gap", () => {
      const id = store.createSession();
      expect(() =>
        store.appendEvents(
          id,
          [
            { type: "turn/start", seq: 0, time: 1, data: {} },
            { type: "turn/end", seq: 2, time: 2, data: { reason: "completed" } },
          ],
          1,
        ),
      ).toThrow(/seq gap/);
      expect(store.readEvents(id)).toEqual([]);
    });

    it("bumps session updated_at on append", () => {
      const id = store.createSession();
      const before = store.getSession(id)!.updatedAt;
      store.appendEvents(
        id,
        [{ type: "turn/start", seq: 0, time: Date.now(), data: {} }],
        1,
      );
      expect(store.getSession(id)!.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it("maxSeq returns null for a session without events", () => {
      const id = store.createSession();
      expect(store.maxSeq(id)).toBeNull();
    });

    it("refuses to read events with a future schema version", () => {
      const id = store.createSession();
      store.appendEvents(
        id,
        [{ type: "turn/start", seq: 0, time: 1, data: {} }],
        999,
      );
      expect(() => store.readEvents(id)).toThrow(/schema_version=999.*up to 1.*upgrade/i);
    });
  });

  describe("readEventsAfter", () => {
    const seedThree = (): string => {
      const id = store.createSession();
      const log = SessionEventLog.open(store, id);
      log.append("turn/start", {});
      log.append("user/message", { message: legacyUserMsg("hello") });
      log.append("turn/end", { reason: "completed" });
      return id;
    };

    it("returns only events after sinceSeq in ascending order", () => {
      const id = seedThree();
      const tail = store.readEventsAfter(id, 0, 10);
      expect(tail.map((e) => [e.type, e.seq])).toEqual([
        ["user/message", 1],
        ["turn/end", 2],
      ]);
    });

    it("returns the full log when sinceSeq is -1", () => {
      const id = seedThree();
      expect(store.readEventsAfter(id, -1, 10)).toHaveLength(3);
    });

    it("returns an empty array when sinceSeq is at or past the tail", () => {
      const id = seedThree();
      expect(store.readEventsAfter(id, 2, 10)).toEqual([]);
      expect(store.readEventsAfter(id, 99, 10)).toEqual([]);
    });

    it("applies the limit from the oldest matching seq", () => {
      const id = seedThree();
      const tail = store.readEventsAfter(id, -1, 2);
      expect(tail.map((e) => e.seq)).toEqual([0, 1]);
    });

    it("returns an empty array for a session without events", () => {
      const id = store.createSession();
      expect(store.readEventsAfter(id, -1, 10)).toEqual([]);
    });
  });

  describe("needsMigration / migrated bookkeeping", () => {
    it("fresh session with no history does not need migration", () => {
      const id = store.createSession();
      expect(store.sessionNeedsMigration(id)).toBe(false);
    });

    it("legacy session with messages needs migration", () => {
      const id = seedLegacySession();
      expect(store.sessionNeedsMigration(id)).toBe(true);
      expect(store.isMigrated(id)).toBe(false);
    });

    it("session with events does not need migration", () => {
      const id = store.createSession();
      const log = SessionEventLog.open(store, id);
      log.append("turn/start", {});
      expect(store.sessionNeedsMigration(id)).toBe(false);
    });

    it("migrateEvents atomically writes events and marks the session migrated", () => {
      const id = seedLegacySession();
      store.migrateEvents(
        id,
        [{ type: "user/message", seq: 0, time: 1, data: { message: legacyUserMsg("q") } }],
        1,
      );
      expect(store.isMigrated(id)).toBe(true);
      expect(store.sessionNeedsMigration(id)).toBe(false);
      expect(store.readEvents(id)).toHaveLength(1);
    });
  });

  describe("legacy read paths remain functional", () => {
    it("getSessionMessagesWithIds still reads legacy messages", () => {
      const id = seedLegacySession();
      const rows = store.getSessionMessagesWithIds(id);
      expect(rows).toHaveLength(2);
      expect((rows[0].message as { content: unknown }).content).toBe("q1");
    });

    it("getLatestCompaction still reads legacy compactions", () => {
      const id = seedLegacySession();
      const db = new Database(dbPath);
      db.prepare(
        "INSERT INTO compactions (session_id, anchor_message_id, digest_content, token_estimate, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, 1, "digest", 10, Date.now());
      db.close();
      const latest = store.getLatestCompaction(id);
      expect(latest).not.toBeNull();
      expect(latest!.digestContent).toBe("digest");
    });
  });

  describe("schema migrations on existing DB", () => {
    it("adds events table and new session columns to a legacy DB", () => {
      store.close();

      const legacyDbPath = path.join(tmpDir, "legacy.db");
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
          timestamp INTEGER NOT NULL
        );
      `);
      legacy.close();

      const reopened = new SessionStore(legacyDbPath, agentId);
      try {
        const cols = new Database(legacyDbPath, { readonly: true })
          .prepare("PRAGMA table_info(sessions)")
          .all() as Array<{ name: string }>;
        const names = cols.map((c) => c.name);
        expect(names).toContain("parent_session_id");
        expect(names).toContain("fork_seq");
        expect(names).toContain("migrated_at");

        const tables = new Database(legacyDbPath, { readonly: true })
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
          .all();
        expect(tables).toHaveLength(1);
      } finally {
        reopened.close();
      }
    });
  });
});
