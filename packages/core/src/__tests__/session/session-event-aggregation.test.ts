import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSilentLogger } from "../../logger.js";

const { getChatStreamFnMock, resolveModelByIdMock } = vi.hoisted(() => ({
  getChatStreamFnMock: vi.fn(() => vi.fn()),
  resolveModelByIdMock: vi.fn((modelId: string) => {
    const slashIdx = modelId.indexOf("/");
    return slashIdx >= 0
      ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
      : { id: modelId, provider: modelId };
  }),
}));

vi.mock("../../model-providers/catalog.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../model-providers/catalog.js")>();
  return {
    ...actual,
    ModelCatalog: class {
      getChatStreamFn = getChatStreamFnMock;
      resolveModelById = resolveModelByIdMock;
    },
  };
});

import { createProject } from "../../factory.js";
import type { SessionEvent } from "../../session/events.js";

const TEST_AGENT_PROFILE = `---
name: Test Agent
tools:
  - read_file
---

Test agent for aggregation.`;

interface AggregatedEvent {
  event: SessionEvent;
  ctx: { agentId: string; sessionId: string };
}

describe("SessionManager.onSessionEvent aggregation", () => {
  let tmpDir: string;
  let runtime: any;
  let agentId: string;
  let events: AggregatedEvent[];
  let unsubscribe: () => void;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mgr-agg-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    });
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
    events = [];
    unsubscribe = runtime.sessionRuntime.onSessionEvent(
      (event: SessionEvent, ctx: { agentId: string; sessionId: string }) => {
        events.push({ event, ctx });
      },
    );
  });

  afterEach(() => {
    unsubscribe();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const seedSession = (): string => {
    const agentStore = runtime.projectManager.projectStore.agents.get(agentId) as any;
    const sessionId = agentStore.sessions.createSession();
    agentStore.sessions.appendEvents(
      sessionId,
      [
        {
          type: "user/message",
          seq: 0,
          time: 1,
          data: { message: { role: "user", content: "q1", timestamp: 1 } },
        },
        {
          type: "assistant/message",
          seq: 1,
          time: 2,
          data: {
            message: { role: "assistant", content: [{ type: "text", text: "a1" }], timestamp: 2 },
          },
        },
        { type: "turn/end", seq: 2, time: 3, data: { reason: "completed" } },
      ],
      1,
    );
    return sessionId;
  };

  it("delivers events from a session created after subscription with agent/session context", async () => {
    const sessionId = seedSession();
    await runtime.sessionRuntime.restoreSession(agentId, sessionId);
    await runtime.sessionRuntime.withdrawLastTurn(sessionId);
    const aggregated = events.filter((e) => e.event.type === "turn/withdrawn");
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].ctx).toEqual({ agentId, sessionId });
  });

  it("backfills sessions that already existed at subscription time", async () => {
    unsubscribe();
    const sessionId = seedSession();
    await runtime.sessionRuntime.restoreSession(agentId, sessionId);
    events = [];
    unsubscribe = runtime.sessionRuntime.onSessionEvent(
      (event: SessionEvent, ctx: { agentId: string; sessionId: string }) => {
        events.push({ event, ctx });
      },
    );
    await runtime.sessionRuntime.withdrawLastTurn(sessionId);
    expect(events.some((e) => e.event.type === "turn/withdrawn")).toBe(true);
  });

  it("stops delivering after the listener unsubscribes", async () => {
    const sessionId = seedSession();
    await runtime.sessionRuntime.restoreSession(agentId, sessionId);
    unsubscribe();
    await runtime.sessionRuntime.withdrawLastTurn(sessionId);
    expect(events.filter((e) => e.event.type === "turn/withdrawn")).toHaveLength(0);
  });

  it("stops delivering after the session is destroyed", async () => {
    const sessionId = seedSession();
    await runtime.sessionRuntime.restoreSession(agentId, sessionId);
    runtime.sessionRuntime.destroySession(sessionId);
    events.length = 0;
    const other = seedSession();
    await runtime.sessionRuntime.restoreSession(agentId, other);
    await runtime.sessionRuntime.withdrawLastTurn(other);
    expect(events.some((e) => e.ctx.sessionId === sessionId)).toBe(false);
    expect(events.some((e) => e.ctx.sessionId === other)).toBe(true);
  });
});
