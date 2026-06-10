import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import matter from "gray-matter";
import { SessionStore } from "../../store/session.js";

function createAgentDir(
  agentsDir: string,
  agentId: string,
  slug: string,
): string {
  const shortId = agentId.slice(0, 6);
  const dirName = `${slug}-${shortId}`;
  const dirPath = path.join(agentsDir, dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  const profileContent = matter.stringify("Test agent", { id: agentId, name: slug });
  fs.writeFileSync(path.join(dirPath, "profile.md"), profileContent, "utf-8");
  return dirPath;
}

describe("SessionStore", () => {
  let store: SessionStore;
  let agentsDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-session-"));
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    store = new SessionStore(agentsDir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates and retrieves a session", () => {
    createAgentDir(agentsDir, "agent-1", "test-agent");
    const id = store.createSession("agent-1", "Test Session");
    const session = store.getSession("agent-1", id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(session!.agentId).toBe("agent-1");
    expect(session!.title).toBe("Test Session");
    expect(session!.status).toBe("active");
  });

  it("creates session without title", () => {
    createAgentDir(agentsDir, "agent-1", "test-agent");
    const id = store.createSession("agent-1");
    const session = store.getSession("agent-1", id);
    expect(session!.title).toBeUndefined();
  });

  it("returns null for non-existent session", () => {
    createAgentDir(agentsDir, "agent-1", "test-agent");
    expect(store.getSession("agent-1", "no-such-id")).toBeNull();
  });

  it("lists sessions for specific agent", () => {
    createAgentDir(agentsDir, "agent-1", "test-agent");
    store.createSession("agent-1", "First");
    store.createSession("agent-1", "Second");
    const sessions = store.listSessions("agent-1");
    expect(sessions).toHaveLength(2);
  });

  it("isolates sessions between agents", () => {
    createAgentDir(agentsDir, "agent-1", "agent-a");
    createAgentDir(agentsDir, "agent-2", "agent-b");
    store.createSession("agent-1", "A1");
    store.createSession("agent-2", "B1");
    const a1 = store.listSessions("agent-1");
    const a2 = store.listSessions("agent-2");
    expect(a1).toHaveLength(1);
    expect(a1[0].agentId).toBe("agent-1");
    expect(a2).toHaveLength(1);
    expect(a2[0].agentId).toBe("agent-2");
  });

  it("archives a session", () => {
    createAgentDir(agentsDir, "agent-1", "test-agent");
    const id = store.createSession("agent-1", "To Archive");
    store.archiveSession("agent-1", id);
    const session = store.getSession("agent-1", id);
    expect(session!.status).toBe("archived");
    const active = store.listSessions("agent-1");
    expect(active).toHaveLength(0);
  });

  it("appends and retrieves messages", () => {
    createAgentDir(agentsDir, "agent-1", "test-agent");
    const id = store.createSession("agent-1");
    store.appendMessage("agent-1", id, { role: "user", content: "hello", timestamp: 1000 });
    store.appendMessage("agent-1", id, { role: "assistant", content: "world", timestamp: 2000 });
    const messages = store.getSessionMessages("agent-1", id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("hello");
    expect(messages[1].content).toBe("world");
  });

  it("updates session updated_at on message append", () => {
    createAgentDir(agentsDir, "agent-1", "test-agent");
    const id = store.createSession("agent-1");
    const before = store.getSession("agent-1", id)!.updatedAt;
    store.appendMessage("agent-1", id, { role: "user", content: "hi", timestamp: Date.now() });
    const after = store.getSession("agent-1", id)!.updatedAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("updates session title", () => {
    createAgentDir(agentsDir, "agent-1", "test-agent");
    const id = store.createSession("agent-1", "Old Title");
    store.updateSessionTitle("agent-1", id, "New Title");
    const session = store.getSession("agent-1", id);
    expect(session!.title).toBe("New Title");
  });

  it("lazy opens db on first access", () => {
    const agentDir = createAgentDir(agentsDir, "agent-1", "test-agent");
    const dbPath = path.join(agentDir, "sessions.db");
    expect(fs.existsSync(dbPath)).toBe(false);
    store.createSession("agent-1");
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("closes agent connection", () => {
    createAgentDir(agentsDir, "agent-1", "test-agent");
    store.createSession("agent-1");
    store.closeAgent("agent-1");
    expect(() => store.listSessions("agent-1")).not.toThrow();
  });
});
