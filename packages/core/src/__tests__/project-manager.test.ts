import { describe, expect, it, vi } from "vitest";
import { createSilentLogger } from "../logger.js";
import { ProjectManager } from "../project-manager.js";
import type { SessionInfo } from "../types.js";
import { ProjectStore } from "../store/project.js";
import type { AgentStore } from "../store/agent-store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EVENT_SCHEMA_VERSION } from "../session/events.js";

function createProjectManagerWithSessions(initial: Record<string, SessionInfo>) {
  const sessions = new Map(Object.entries(initial));
  const sessionStore = {
    getSession: vi.fn((id: string) => sessions.get(id) ?? null),
    updateSessionTitle: vi.fn((id: string, title: string) => {
      const session = sessions.get(id);
      if (session) sessions.set(id, { ...session, title });
    }),
  };

  const agentStore = {
    getProfile: vi.fn(() => ({ id: "agent-1", name: "Test", slug: "test", systemPrompt: "", filePath: "" })),
    sessions: sessionStore,
  } as unknown as AgentStore;

  const projectStore = {
    getAgent: vi.fn(() => agentStore),
  } as unknown as ProjectStore;

  const manager = new ProjectManager(projectStore, createSilentLogger());

  return { manager, sessionStore };
}

describe("ProjectManager.renameSession", () => {
  it("renames an existing session and returns the updated session", () => {
    const session: SessionInfo = {
      id: "session-1",
      agentId: "agent-1",
      createdAt: 1,
      updatedAt: 2,
      status: "active",
    };
    const { manager, sessionStore } = createProjectManagerWithSessions({ "session-1": session });

    const updated = manager.renameSession("agent-1", "session-1", "  New Title  ");

    expect(sessionStore.updateSessionTitle).toHaveBeenCalledWith("session-1", "New Title");
    expect(updated).toEqual({ ...session, title: "New Title" });
    expect(updated.updatedAt).toBe(2);
  });

  it("rejects an empty title", () => {
    const { manager } = createProjectManagerWithSessions({
      "session-1": {
        id: "session-1",
        agentId: "agent-1",
        createdAt: 1,
        updatedAt: 2,
        status: "active",
      },
    });

    expect(() => manager.renameSession("agent-1", "session-1", "   ")).toThrow("title is required");
  });

  it("rejects a title longer than 80 characters", () => {
    const { manager } = createProjectManagerWithSessions({
      "session-1": {
        id: "session-1",
        agentId: "agent-1",
        createdAt: 1,
        updatedAt: 2,
        status: "active",
      },
    });

    expect(() => manager.renameSession("agent-1", "session-1", "a".repeat(81))).toThrow(
      "title must be 80 characters or less",
    );
  });

  it("throws when the session does not exist", () => {
    const { manager } = createProjectManagerWithSessions({});

    expect(() => manager.renameSession("agent-1", "missing", "New Title")).toThrow(
      'Session "missing" not found',
    );
  });
});

describe("ProjectManager event-backed session reads", () => {
  const setup = async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pm-events-"));
    const projectStore = new ProjectStore(root, createSilentLogger());
    await projectStore.create("Test");
    const agentStore = await projectStore.createAgent(
      "test-agent",
      "---\nname: Test\ntools: []\n---\n\nTest.",
    );
    const manager = new ProjectManager(projectStore, createSilentLogger());
    return { root, projectStore, agentStore, manager };
  };

  it("pages only folded message entries", async () => {
    const { root, projectStore, agentStore, manager } = await setup();
    try {
      const sessionId = agentStore.sessions.createSession();
      agentStore.sessions.appendEvents(
        sessionId,
        [
          {
            type: "user/message",
            seq: 0,
            time: 1,
            data: { message: { role: "user", content: "q", timestamp: 1 } as never },
          },
          { type: "turn/start", seq: 1, time: 1, data: {} },
          {
            type: "assistant/message",
            seq: 2,
            time: 2,
            data: {
              message: {
                role: "assistant",
                content: [{ type: "text", text: "a" }],
                timestamp: 2,
              } as never,
            },
          },
          { type: "turn/end", seq: 3, time: 2, data: { reason: "completed" } },
        ],
        EVENT_SCHEMA_VERSION,
      );

      expect(manager.getRecentSessionHistory(agentStore.getProfile().id, sessionId, 10)).toEqual({
        entries: [
          { id: 0, message: expect.objectContaining({ role: "user", content: "q" }) },
          { id: 2, message: expect.objectContaining({ role: "assistant" }) },
        ],
        hasMore: false,
        oldestId: 0,
      });
    } finally {
      projectStore.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("slices by message count, honors the before cursor exclusively, and reports hasMore", async () => {
    const { root, projectStore, agentStore, manager } = await setup();
    try {
      const sessionId = agentStore.sessions.createSession();
      agentStore.sessions.appendEvents(
        sessionId,
        [
          { type: "user/message", seq: 0, time: 1, data: { message: { role: "user", content: "u0", timestamp: 1 } as never } },
          { type: "user/message", seq: 1, time: 1, data: { message: { role: "user", content: "u1", timestamp: 1 } as never } },
          { type: "assistant/message", seq: 2, time: 2, data: { message: { role: "assistant", content: [{ type: "text", text: "a2" }], timestamp: 2 } as never } },
          { type: "user/message", seq: 3, time: 3, data: { message: { role: "user", content: "u3", timestamp: 3 } as never } },
          { type: "assistant/message", seq: 4, time: 4, data: { message: { role: "assistant", content: [{ type: "text", text: "a4" }], timestamp: 4 } as never } },
        ],
        EVENT_SCHEMA_VERSION,
      );
      const agentId = agentStore.getProfile().id;

      const firstPage = manager.getRecentSessionHistory(agentId, sessionId, 2);
      expect(firstPage.entries.map((e) => e.id)).toEqual([3, 4]);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.oldestId).toBe(3);

      const nextPage = manager.getRecentSessionHistory(agentId, sessionId, 2, firstPage.oldestId!);
      expect(nextPage.entries.map((e) => e.id)).toEqual([1, 2]);
      expect(nextPage.hasMore).toBe(true);
      expect(nextPage.oldestId).toBe(1);

      const thirdPage = manager.getRecentSessionHistory(agentId, sessionId, 2, nextPage.oldestId!);
      expect(thirdPage.entries.map((e) => e.id)).toEqual([0]);
      expect(thirdPage.hasMore).toBe(false);
      expect(thirdPage.oldestId).toBe(0);

      const lastPage = manager.getRecentSessionHistory(agentId, sessionId, 2, thirdPage.oldestId!);
      expect(lastPage.entries).toEqual([]);
      expect(lastPage.hasMore).toBe(false);
      expect(lastPage.oldestId).toBeNull();
    } finally {
      projectStore.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("extends the page head past orphan toolResults on the event path", async () => {
    const { root, projectStore, agentStore, manager } = await setup();
    try {
      const sessionId = agentStore.sessions.createSession();
      agentStore.sessions.appendEvents(
        sessionId,
        [
          { type: "user/message", seq: 0, time: 1, data: { message: { role: "user", content: "u0", timestamp: 1 } as never } },
          { type: "assistant/message", seq: 1, time: 2, data: { message: { role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "t" }], timestamp: 2 } as never } },
          { type: "tool/result", seq: 2, time: 3, data: { message: { role: "toolResult", toolCallId: "tc1", toolName: "t", content: [{ type: "text", text: "r1" }], isError: false, timestamp: 3 } as never } },
          { type: "tool/result", seq: 3, time: 3, data: { message: { role: "toolResult", toolCallId: "tc2", toolName: "t", content: [{ type: "text", text: "r2" }], isError: false, timestamp: 3 } as never } },
        ],
        EVENT_SCHEMA_VERSION,
      );

      const result = manager.getRecentSessionHistory(agentStore.getProfile().id, sessionId, 2);
      expect(result.entries.map((e) => e.message.role)).toEqual([
        "assistant",
        "toolResult",
        "toolResult",
      ]);
      expect(result.hasMore).toBe(true);
      expect(result.oldestId).toBe(1);
    } finally {
      projectStore.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ProjectManager history fold cache", () => {
  const setup = async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pm-cache-"));
    const projectStore = new ProjectStore(root, createSilentLogger());
    await projectStore.create("Test");
    const agentStore = await projectStore.createAgent(
      "test-agent",
      "---\nname: Test\ntools: []\n---\n\nTest.",
    );
    const manager = new ProjectManager(projectStore, createSilentLogger());
    return { root, projectStore, agentStore, manager };
  };

  const userEvent = (seq: number, text: string) => ({
    type: "user/message" as const,
    seq,
    time: seq,
    data: { message: { role: "user", content: text, timestamp: seq } },
  });
  const assistantEvent = (seq: number, text: string) => ({
    type: "assistant/message" as const,
    seq,
    time: seq,
    data: { message: { role: "assistant", content: [{ type: "text", text }], timestamp: seq } },
  });

  it("cached pagination equals a fresh full re-fold for arbitrary event sequences", async () => {
    const { root, projectStore, agentStore, manager } = await setup();
    try {
      const sessionId = agentStore.sessions.createSession();
      const events: Array<ReturnType<typeof userEvent> | ReturnType<typeof assistantEvent>> = [];
      for (let i = 0; i < 40; i++) {
        events.push(i % 2 === 0 ? userEvent(i, `q${i}`) : assistantEvent(i, `a${i}`));
      }
      agentStore.sessions.appendEvents(sessionId, events, EVENT_SCHEMA_VERSION);
      const agentId = agentStore.getProfile().id;

      const { deriveHistoryEntries } = await import("../session/fold.js");
      const fresh = deriveHistoryEntries(agentStore.sessions.readEvents(sessionId));
      let cursor: number | undefined;
      const seen: number[] = [];
      for (;;) {
        const page = manager.getRecentSessionHistory(agentId, sessionId, 3, cursor);
        seen.push(...page.entries.map((e) => e.id));
        if (!page.hasMore || page.oldestId === null) break;
        cursor = page.oldestId;
      }
      expect([...seen].sort((a, b) => a - b)).toEqual(fresh.map((e) => e.seq));
      expect(new Set(seen).size).toBe(seen.length);
      expect(manager.getRecentSessionHistory(agentId, sessionId, 5).entries).toEqual(
        fresh.slice(-5).map((entry) => expect.objectContaining({ id: entry.seq })),
      );
    } finally {
      projectStore.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("invalidates on event count change and reflects new appends", async () => {
    const { root, projectStore, agentStore, manager } = await setup();
    try {
      const sessionId = agentStore.sessions.createSession();
      const agentId = agentStore.getProfile().id;
      agentStore.sessions.appendEvents(
        sessionId,
        [userEvent(0, "q0"), assistantEvent(1, "a0")],
        EVENT_SCHEMA_VERSION,
      );
      expect(manager.getRecentSessionHistory(agentId, sessionId, 10).entries).toHaveLength(2);
      agentStore.sessions.appendEvents(
        sessionId,
        [userEvent(2, "q1"), assistantEvent(3, "a1")],
        EVENT_SCHEMA_VERSION,
      );
      const after = manager.getRecentSessionHistory(agentId, sessionId, 10);
      expect(after.entries).toHaveLength(4);
      expect(after.entries.at(-1)).toMatchObject({ id: 3 });
    } finally {
      projectStore.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("evicts least-recently-used sessions beyond the cache limit without changing results", async () => {
    const { root, projectStore, agentStore, manager } = await setup();
    try {
      const agentId = agentStore.getProfile().id;
      const sessionIds: string[] = [];
      for (let i = 0; i < 34; i++) {
        const sessionId = agentStore.sessions.createSession();
        agentStore.sessions.appendEvents(
          sessionId,
          [userEvent(0, `q${i}`)],
          EVENT_SCHEMA_VERSION,
        );
        sessionIds.push(sessionId);
        manager.getRecentSessionHistory(agentId, sessionId, 10);
      }
      const first = manager.getRecentSessionHistory(agentId, sessionIds[0], 10);
      expect(first.entries).toHaveLength(1);
      const last = manager.getRecentSessionHistory(agentId, sessionIds[33], 10);
      expect(last.entries).toHaveLength(1);
    } finally {
      projectStore.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
