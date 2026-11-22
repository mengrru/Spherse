import { describe, expect, it, vi } from "vitest";
import { ConflictError } from "@spherse/core";
import type { SessionManager, TriggerManager } from "@spherse/core";
import { triggerMethods } from "../methods/triggers.js";
import { debugMethods } from "../methods/debug.js";
import { createFakeProjectCtx, createRpcHarness, flush } from "../testing.js";

const NEXT_AT = 1700000000000;

function baseEntry() {
  return {
    id: "t1",
    enabled: true,
    type: "time",
    cron: "* * * * *",
    mode: "new_session",
    message: "hello",
    notify: false,
    createdAt: 100,
    updatedAt: 100,
  };
}

function reusableEntry() {
  return { ...baseEntry(), mode: "reusable_session", boundSessionId: "s9", cron: undefined };
}

function logEntry() {
  return {
    triggerId: "t1",
    sessionId: "s1",
    triggeredAt: 123,
    status: "success" as const,
  };
}

function turnContextSnapshot() {
  return {
    sessionId: "s1",
    capturedAt: "2026-01-01T00:00:00.000Z",
    systemPrompt: "sys",
    messages: [],
    tools: [],
    compaction: null,
    compactionCount: 0,
  };
}

function sessionEvent() {
  return { seq: 1, type: "user_message", time: 1, data: {} };
}

function createTestHarness() {
  const triggerMocks = {
    listProject: vi.fn(() => [{ agentId: "a1", entry: baseEntry(), nextTriggerAt: new Date(NEXT_AT) }]),
    list: vi.fn(() => [baseEntry()]),
    get: vi.fn(() => baseEntry()),
    create: vi.fn(),
    update: vi.fn(() => baseEntry()),
    delete: vi.fn(),
    runNow: vi.fn(() => baseEntry()),
    getNextTrigger: vi.fn(() => new Date(NEXT_AT)),
    getRecentLogs: vi.fn(() => [logEntry()]),
  };
  const sessionMocks = {
    getTurnContext: vi.fn(() => turnContextSnapshot()),
    readSessionEventsAfter: vi.fn(() => [sessionEvent()]),
  };
  const projectCtx = createFakeProjectCtx({
    triggerManager: triggerMocks as unknown as TriggerManager,
    sessionRuntime: sessionMocks as unknown as SessionManager,
  });
  const harness = createRpcHarness({
    methods: { ...triggerMethods, ...debugMethods },
    projectCtx,
  });
  return { harness, tm: triggerMocks, sr: sessionMocks };
}

function okResult(frame: unknown) {
  expect(frame).toMatchObject({ type: "result", ok: true });
  return (frame as { data: unknown }).data;
}

describe("rpc trigger methods", () => {
  it("triggers.list returns entries with next trigger time", async () => {
    const { harness, tm } = createTestHarness();
    harness.receive({ type: "call", id: 1, method: "triggers.list", params: { projectId: "p1", agentId: "a1" } });
    await flush();
    expect(tm.list).toHaveBeenCalledWith("a1");
    expect(tm.getNextTrigger).toHaveBeenCalledWith("a1", "t1");
    expect(okResult(harness.sent()[0])).toEqual([{ ...baseEntry(), nextTriggerAt: NEXT_AT }]);
  });

  it("triggers.listProject returns all project triggers", async () => {
    const { harness, tm } = createTestHarness();
    harness.receive({ type: "call", id: 2, method: "triggers.listProject", params: { projectId: "p1" } });
    await flush();
    expect(tm.listProject).toHaveBeenCalled();
    expect(okResult(harness.sent()[0])).toEqual({
      ok: true,
      triggers: [{ agentId: "a1", ...baseEntry(), nextTriggerAt: NEXT_AT }],
    });
  });

  it("triggers.create validates, persists and returns the entry", async () => {
    const { harness, tm } = createTestHarness();
    harness.receive({
      type: "call",
      id: 3,
      method: "triggers.create",
      params: {
        projectId: "p1",
        agentId: "a1",
        type: "time",
        cron: "* * * * *",
        mode: "new_session",
        message: "hello",
        notify: false,
      },
    });
    await flush();
    expect(tm.create).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({
        enabled: true,
        type: "time",
        cron: "* * * * *",
        mode: "new_session",
        message: "hello",
        notify: false,
      }),
    );
    expect(okResult(harness.sent()[0])).toEqual(
      expect.objectContaining({ type: "time", cron: "* * * * *", mode: "new_session", message: "hello" }),
    );
  });

  it("triggers.update applies a partial patch to an existing trigger", async () => {
    const { harness, tm } = createTestHarness();
    harness.receive({
      type: "call",
      id: 4,
      method: "triggers.update",
      params: { projectId: "p1", agentId: "a1", triggerId: "t1", enabled: false },
    });
    await flush();
    expect(tm.get).toHaveBeenCalledWith("a1", "t1");
    expect(tm.update).toHaveBeenCalledWith("a1", "t1", { enabled: false });
    expect(okResult(harness.sent()[0])).toEqual(expect.objectContaining({ id: "t1" }));
  });

  it("triggers.delete removes the trigger", async () => {
    const { harness, tm } = createTestHarness();
    harness.receive({
      type: "call",
      id: 5,
      method: "triggers.delete",
      params: { projectId: "p1", agentId: "a1", triggerId: "t1" },
    });
    await flush();
    expect(tm.delete).toHaveBeenCalledWith("a1", "t1");
    expect(okResult(harness.sent()[0])).toEqual({ ok: true });
  });

  it("triggers.run fires an existing trigger immediately", async () => {
    const { harness, tm } = createTestHarness();
    harness.receive({
      type: "call",
      id: 6,
      method: "triggers.run",
      params: { projectId: "p1", agentId: "a1", triggerId: "t1" },
    });
    await flush();
    expect(tm.get).toHaveBeenCalledWith("a1", "t1");
    expect(tm.runNow).toHaveBeenCalledWith("a1", "t1");
    expect(okResult(harness.sent()[0])).toEqual({ ok: true });
  });

  it("triggers.resetBinding clears the bound session of a reusable trigger", async () => {
    const { harness, tm } = createTestHarness();
    tm.get.mockReturnValue(reusableEntry());
    tm.update.mockReturnValue(reusableEntry());
    harness.receive({
      type: "call",
      id: 7,
      method: "triggers.resetBinding",
      params: { projectId: "p1", agentId: "a1", triggerId: "t1" },
    });
    await flush();
    expect(tm.get).toHaveBeenCalledWith("a1", "t1");
    expect(tm.update).toHaveBeenCalledWith("a1", "t1", { boundSessionId: undefined });
    expect(okResult(harness.sent()[0])).toEqual(expect.objectContaining({ mode: "reusable_session" }));
  });

  it("triggers.logs returns recent trigger logs", async () => {
    const { harness, tm } = createTestHarness();
    harness.receive({
      type: "call",
      id: 8,
      method: "triggers.logs",
      params: { projectId: "p1", agentId: "a1", limit: 5 },
    });
    await flush();
    expect(tm.getRecentLogs).toHaveBeenCalledWith("a1", 5);
    expect(okResult(harness.sent()[0])).toEqual([logEntry()]);
  });
});

describe("rpc debug methods", () => {
  it("debug.turnContext returns the session turn context snapshot", async () => {
    const { harness, sr } = createTestHarness();
    harness.receive({
      type: "call",
      id: 9,
      method: "debug.turnContext",
      params: { projectId: "p1", sessionId: "s1" },
    });
    await flush();
    expect(sr.getTurnContext).toHaveBeenCalledWith("s1");
    expect(okResult(harness.sent()[0])).toEqual(turnContextSnapshot());
  });

  it("debug.sessionEvents returns the full session event log", async () => {
    const { harness, sr } = createTestHarness();
    harness.receive({
      type: "call",
      id: 10,
      method: "debug.sessionEvents",
      params: { projectId: "p1", agentId: "a1", sessionId: "s1" },
    });
    await flush();
    expect(sr.readSessionEventsAfter).toHaveBeenCalledWith(
      "a1",
      "s1",
      -1,
      Number.MAX_SAFE_INTEGER,
    );
    expect(okResult(harness.sent()[0])).toEqual({ sessionId: "s1", events: [sessionEvent()] });
  });
});

describe("rpc trigger/debug method error mapping", () => {
  it("maps unknown project to app error 100", async () => {
    const { harness } = createTestHarness();
    harness.receive({
      type: "call",
      id: 11,
      method: "triggers.list",
      params: { projectId: "missing", agentId: "a1" },
    });
    await flush();
    expect(harness.sent()[0]).toMatchObject({
      type: "result",
      id: 11,
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });

  it("maps invalid params to -32602", async () => {
    const { harness } = createTestHarness();
    harness.receive({
      type: "call",
      id: 12,
      method: "triggers.logs",
      params: { projectId: "p1", agentId: "a1", limit: 0 },
    });
    await flush();
    expect(harness.sent()[0]).toMatchObject({
      type: "result",
      id: 12,
      ok: false,
      error: { code: -32602 },
    });
  });

  it("maps ConflictError from the facade to app error 102", async () => {
    const { harness, tm } = createTestHarness();
    tm.list.mockImplementation(() => {
      throw new ConflictError("trigger conflict");
    });
    harness.receive({
      type: "call",
      id: 13,
      method: "triggers.list",
      params: { projectId: "p1", agentId: "a1" },
    });
    await flush();
    expect(harness.sent()[0]).toMatchObject({
      type: "result",
      id: 13,
      ok: false,
      error: { code: 102, message: "trigger conflict" },
    });
  });

  it("maps missing trigger to app error 100", async () => {
    const { harness, tm } = createTestHarness();
    tm.get.mockReturnValue(null);
    harness.receive({
      type: "call",
      id: 14,
      method: "triggers.run",
      params: { projectId: "p1", agentId: "a1", triggerId: "t1" },
    });
    await flush();
    expect(harness.sent()[0]).toMatchObject({
      type: "result",
      id: 14,
      ok: false,
      error: { code: 100, message: "Trigger not found" },
    });
  });
});
