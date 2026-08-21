import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import { SessionStore } from "../../store/session.js";
import { SessionEventLog } from "../../session/event-log.js";
import { EVENT_SCHEMA_VERSION } from "../../session/events.js";

describe("SessionEventLog", () => {
  let tmpDir: string;
  let store: SessionStore;
  let sessionId: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-event-log-"));
    store = new SessionStore(path.join(tmpDir, "sessions.db"), "agent-1");
    sessionId = store.createSession();
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends events with contiguous seq starting at 0", () => {
    const log = SessionEventLog.open(store, sessionId);
    const first = log.append("turn/start", { turn: 0 });
    expect(first.seq).toBe(0);
    expect(first.type).toBe("turn/start");
    const second = log.append("turn/end", { turn: 0, reason: "completed" });
    expect(second.seq).toBe(1);

    const persisted = store.readEvents(sessionId);
    expect(persisted.map((e) => [e.type, e.seq])).toEqual([
      ["turn/start", 0],
      ["turn/end", 1],
    ]);
  });

  it("appends a semantic batch atomically with contiguous seq", () => {
    const log = SessionEventLog.open(store, sessionId);
    const events = log.appendBatch([
      {
        type: "user/message",
        data: { message: { role: "user", content: "hello", timestamp: 1 } },
      },
      { type: "turn/start", data: { turn: 0 } },
    ]);

    expect(events.map((event) => event.seq)).toEqual([0, 1]);
    expect(store.readEvents(sessionId).map((event) => event.type)).toEqual([
      "user/message",
      "turn/start",
    ]);
  });

  it("notifies subscribers and survives listener errors", () => {
    const log = SessionEventLog.open(store, sessionId);
    const heard: string[] = [];
    const badListener = vi.fn(() => {
      throw new Error("boom");
    });
    log.subscribe(badListener);
    log.subscribe((e) => heard.push(e.type));

    log.append("turn/start", { turn: 0 });
    log.append("turn/end", { turn: 0, reason: "aborted" });

    expect(badListener).toHaveBeenCalledTimes(2);
    expect(heard).toEqual(["turn/start", "turn/end"]);
  });

  it("unsubscribe stops notifications", () => {
    const log = SessionEventLog.open(store, sessionId);
    const heard: string[] = [];
    const dispose = log.subscribe((e) => heard.push(e.type));
    log.append("turn/start", { turn: 0 });
    dispose();
    log.append("turn/end", { turn: 0, reason: "completed" });
    expect(heard).toEqual(["turn/start"]);
  });

  it("open reloads persisted events and continues seq", () => {
    const log1 = SessionEventLog.open(store, sessionId);
    log1.append("turn/start", { turn: 0 });
    log1.append("turn/end", { turn: 0, reason: "completed" });

    const log2 = SessionEventLog.open(store, sessionId);
    expect(log2.events.length).toBe(2);
    const next = log2.append("turn/start", { turn: 1 });
    expect(next.seq).toBe(2);

    const persisted = store.readEvents(sessionId);
    expect(persisted.length).toBe(3);
    expect(persisted[2].seq).toBe(2);
  });

  it("rolls back memory when a stale concurrent log loses the seq race", () => {
    const first = SessionEventLog.open(store, sessionId);
    const stale = SessionEventLog.open(store, sessionId);
    first.append("turn/start", { turn: 0 });

    expect(() => stale.append("turn/start", { turn: 0 })).toThrow(/must continue/);
    expect(stale.events).toEqual([]);
    expect(store.readEvents(sessionId)).toHaveLength(1);
  });

  it("open rejects corrupt non-contiguous event sequences", () => {
    const log = SessionEventLog.open(store, sessionId);
    log.append("turn/start", { turn: 0 });
    store.close();

    const raw = new Database(path.join(tmpDir, "sessions.db"));
    raw.exec(
      `UPDATE events SET seq = 5 WHERE session_id = '${sessionId}' AND seq = 0`,
    );
    raw.close();

    store = new SessionStore(path.join(tmpDir, "sessions.db"), "agent-1");
    expect(() => SessionEventLog.open(store, sessionId)).toThrow(/Corrupt event log/);
  });

  it("persists with the current schema version", () => {
    const log = SessionEventLog.open(store, sessionId);
    log.append("turn/start", { turn: 0 });
    const raw = new Database(path.join(tmpDir, "sessions.db"));
    const row = raw
      .prepare(`SELECT schema_version FROM events WHERE session_id = ?`)
      .get(sessionId) as { schema_version: number };
    raw.close();
    expect(row.schema_version).toBe(EVENT_SCHEMA_VERSION);
  });
});
