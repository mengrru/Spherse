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
    sessionNeedsMigration: vi.fn(() => false),
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
    expect(updated).toEqual({ ...session, title: "New Title", needsMigration: false });
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
  it("lists needsMigration and pages only folded message entries", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pm-events-"));
    const projectStore = new ProjectStore(root, createSilentLogger());
    await projectStore.create("Test");
    const agentStore = await projectStore.createAgent(
      "test-agent",
      "---\nname: Test\ntools: []\n---\n\nTest.",
    );
    const manager = new ProjectManager(projectStore, createSilentLogger());
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
          { type: "turn/start", seq: 1, time: 1, data: { turn: 0 } },
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
          { type: "turn/end", seq: 3, time: 2, data: { turn: 0, reason: "completed" } },
        ],
        EVENT_SCHEMA_VERSION,
      );

      expect(manager.listSessions(agentStore.getProfile().id)[0].needsMigration).toBe(false);
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
});
