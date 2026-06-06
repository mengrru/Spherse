import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import pino from "pino";
import { SessionStore } from "../../store/session.js";

describe("SessionStore", () => {
  let store: SessionStore;
  let dbPath: string;
  let tmpDir: string;

  beforeEach(async () => {
    store = new SessionStore(pino({ level: "silent" }));
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wb-session-"));
    dbPath = path.join(tmpDir, "test.db");
    await store.init(dbPath);
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates and retrieves a session", () => {
    const id = store.createSession("agent-1", "Test Session");
    const session = store.getSession(id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(session!.agentId).toBe("agent-1");
    expect(session!.title).toBe("Test Session");
    expect(session!.status).toBe("active");
  });

  it("creates session without title", () => {
    const id = store.createSession("agent-1");
    const session = store.getSession(id);
    expect(session!.title).toBeUndefined();
  });

  it("returns null for non-existent session", () => {
    expect(store.getSession("no-such-id")).toBeNull();
  });

  it("lists sessions", () => {
    store.createSession("agent-1", "First");
    store.createSession("agent-1", "Second");
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it("lists sessions filtered by agentId", () => {
    store.createSession("agent-1", "A1");
    store.createSession("agent-2", "A2");
    const sessions = store.listSessions("agent-1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agentId).toBe("agent-1");
  });

  it("archives a session", () => {
    const id = store.createSession("agent-1", "To Archive");
    store.archiveSession(id);
    const session = store.getSession(id);
    expect(session!.status).toBe("archived");
    const active = store.listSessions();
    expect(active).toHaveLength(0);
  });

  it("archives all sessions by agentId", () => {
    store.createSession("agent-1", "S1");
    store.createSession("agent-1", "S2");
    store.createSession("agent-2", "S3");
    store.archiveByAgentId("agent-1");
    const active = store.listSessions();
    expect(active).toHaveLength(1);
    expect(active[0].agentId).toBe("agent-2");
  });

  it("appends and retrieves messages", () => {
    const id = store.createSession("agent-1");
    store.appendMessage(id, { role: "user", content: "hello", timestamp: 1000 });
    store.appendMessage(id, { role: "assistant", content: "world", timestamp: 2000 });
    const messages = store.getSessionMessages(id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("hello");
    expect(messages[1].content).toBe("world");
  });

  it("updates session updated_at on message append", () => {
    const id = store.createSession("agent-1");
    const before = store.getSession(id)!.updatedAt;
    store.appendMessage(id, { role: "user", content: "hi", timestamp: Date.now() });
    const after = store.getSession(id)!.updatedAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("updates session title", () => {
    const id = store.createSession("agent-1", "Old Title");
    store.updateSessionTitle(id, "New Title");
    const session = store.getSession(id);
    expect(session!.title).toBe("New Title");
  });
});
