import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionStore } from "../../store/session.js";
import { migrateLegacySession } from "../../session/legacy-migrate.js";
import { deriveMessages, repairLog } from "../../session/fold.js";

function userMsg(text: string, timestamp = 1000): AgentMessage {
  return { role: "user", content: text, timestamp } as AgentMessage;
}

function asstMsg(text: string, timestamp = 2000): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp,
  } as unknown as AgentMessage;
}

describe("legacy-migrate", () => {
  let store: SessionStore;
  let tmpDir: string;
  let dbPath: string;
  const agentId = "agent-1";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-legacy-mig-"));
    dbPath = path.join(tmpDir, "sessions.db");
    store = new SessionStore(dbPath, agentId);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const insertLegacy = (sessionId: string, message: AgentMessage): number => {
    const db = new Database(dbPath);
    const result = db
      .prepare(
        "INSERT INTO messages (session_id, role, content, timestamp, prev_message_id, message_content_schema_version) VALUES (?, ?, ?, ?, NULL, 1)",
      )
      .run(sessionId, message.role, JSON.stringify(message), Date.now());
    db.close();
    return Number(result.lastInsertRowid);
  };

  const insertLegacyCompaction = (sessionId: string, anchorMessageId: number): void => {
    const db = new Database(dbPath);
    db.prepare(
      "INSERT INTO compactions (session_id, anchor_message_id, digest_content, token_estimate, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(sessionId, anchorMessageId, "[user]: earlier", 10, Date.now());
    db.close();
  };

  it("migrates plain message history to message events without turn events", () => {
    const id = store.createSession();
    insertLegacy(id, userMsg("q1"));
    insertLegacy(id, asstMsg("a1"));
    insertLegacy(id, userMsg("q2"));

    const result = migrateLegacySession(store, id);

    expect(result.migrated).toBe(true);
    expect(result.eventCount).toBe(3);
    const events = store.readEvents(id);
    expect(events.map((e) => e.type)).toEqual([
      "user/message",
      "assistant/message",
      "user/message",
    ]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("migration is idempotent", () => {
    const id = store.createSession();
    insertLegacy(id, userMsg("q1"));

    const first = migrateLegacySession(store, id);
    const second = migrateLegacySession(store, id);

    expect(first.migrated).toBe(true);
    expect(second.migrated).toBe(false);
    expect(store.readEvents(id).length).toBe(1);
  });

  it("migrated fold equals full legacy replay", () => {
    const id = store.createSession();
    insertLegacy(id, userMsg("q1"));
    insertLegacy(id, asstMsg("a1"));
    insertLegacy(id, userMsg("q2"));
    insertLegacy(id, asstMsg("a2"));

    const legacyReplay = store.getSessionMessages(id);
    migrateLegacySession(store, id);

    expect(deriveMessages(store.readEvents(id))).toEqual(legacyReplay);
  });

  it("latest compaction anchor becomes compaction/applied with digest tail", () => {
    const id = store.createSession();
    const anchorId = insertLegacy(id, userMsg("covered"));
    insertLegacy(id, userMsg("tail q"));
    insertLegacy(id, asstMsg("tail a"));
    insertLegacyCompaction(id, anchorId);

    migrateLegacySession(store, id);

    const events = store.readEvents(id);
    expect(events[events.length - 1].type).toBe("compaction/applied");
    expect(events[events.length - 1].data).toMatchObject({
      anchorSeq: 0,
      digestContent: "[user]: earlier",
    });

    const messages = deriveMessages(events);
    expect(messages.length).toBe(3);
    expect((messages[0] as { content: string }).content).toContain("<compaction-digest");
    expect((messages[1] as { content: string }).content).toBe("tail q");
  });

  it("repair is a no-op on migrated logs (no turn events)", () => {
    const id = store.createSession();
    insertLegacy(id, userMsg("q"));
    insertLegacy(id, {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc-1", name: "read_file", arguments: {} }],
      stopReason: "toolUse",
      timestamp: 2,
    } as unknown as AgentMessage);

    migrateLegacySession(store, id);
    const events = store.readEvents(id);

    expect(repairLog(events)).toEqual([]);
  });

  it("does not append a repair result for a tool call covered by compaction", () => {
    const id = store.createSession();
    const anchorId = insertLegacy(id, {
      role: "assistant",
      content: [{ type: "toolCall", id: "covered-call", name: "read_file", arguments: {} }],
      stopReason: "toolUse",
      timestamp: 1,
    } as unknown as AgentMessage);
    insertLegacy(id, userMsg("tail"));
    insertLegacyCompaction(id, anchorId);

    migrateLegacySession(store, id);

    const messages = deriveMessages(store.readEvents(id));
    expect(messages.some((message) => message.role === "toolResult")).toBe(false);
  });

  it("migrateLegacySession throws for unknown session", () => {
    expect(() => migrateLegacySession(store, "missing")).toThrow(/not found/);
  });

  it("sessionNeedsMigration flips after migration", () => {
    const id = store.createSession();
    insertLegacy(id, userMsg("q"));
    expect(store.sessionNeedsMigration(id)).toBe(true);

    migrateLegacySession(store, id);
    expect(store.sessionNeedsMigration(id)).toBe(false);
  });
});
