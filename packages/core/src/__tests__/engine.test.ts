import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { Engine } from "../engine.js";
import type { SessionInfo } from "../types.js";
import type { ProjectStore } from "../store/project.js";
import type { AgentStore } from "../store/agent-store.js";

function createEngineWithSessions(initial: Record<string, SessionInfo>) {
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

  const engine = new Engine(projectStore, { logger: pino({ level: "silent" }) });

  return { engine, sessionStore };
}

describe("Engine.renameSession", () => {
  it("renames an existing session and returns the updated session", () => {
    const session: SessionInfo = {
      id: "session-1",
      agentId: "agent-1",
      createdAt: 1,
      updatedAt: 2,
      status: "active",
    };
    const { engine, sessionStore } = createEngineWithSessions({ "session-1": session });

    const updated = engine.renameSession("agent-1", "session-1", "  New Title  ");

    expect(sessionStore.updateSessionTitle).toHaveBeenCalledWith("session-1", "New Title");
    expect(updated).toEqual({ ...session, title: "New Title" });
    expect(updated.updatedAt).toBe(2);
  });

  it("rejects an empty title", () => {
    const { engine } = createEngineWithSessions({
      "session-1": {
        id: "session-1",
        agentId: "agent-1",
        createdAt: 1,
        updatedAt: 2,
        status: "active",
      },
    });

    expect(() => engine.renameSession("agent-1", "session-1", "   ")).toThrow("title is required");
  });

  it("rejects a title longer than 80 characters", () => {
    const { engine } = createEngineWithSessions({
      "session-1": {
        id: "session-1",
        agentId: "agent-1",
        createdAt: 1,
        updatedAt: 2,
        status: "active",
      },
    });

    expect(() => engine.renameSession("agent-1", "session-1", "a".repeat(81))).toThrow(
      "title must be 80 characters or less",
    );
  });

  it("throws when the session does not exist", () => {
    const { engine } = createEngineWithSessions({});

    expect(() => engine.renameSession("agent-1", "missing", "New Title")).toThrow(
      'Session "missing" not found',
    );
  });
});
