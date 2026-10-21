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

const stubCatalog = {
  getChatStreamFn: getChatStreamFnMock,
  resolveModelById: resolveModelByIdMock,
} as never;

import { createProject } from "../../factory.js";
import { AgentRunner } from "../../session/agent-runner.js";
import { SessionControlBus } from "../../session/control-bus.js";
import { RunConfigHolder, type RuntimeDeps } from "../../session/runtime.js";
import { createModelResolver } from "../../session/model-resolver.js";
import { builtinToolCapabilities } from "../../capabilities/builtin.js";
import { createStoreRegistry } from "../../kernel/ports.js";

const TEST_AGENT_PROFILE = `---
name: Fault Agent
tools:
  - run_command
---

Fault agent.`;

interface RuntimeInternals {
  projectManager: { projectStore: { agents: Map<string, unknown> } };
  timerService: { stop: () => void };
}

function getAgentStore(runtime: RuntimeInternals, agentId: string): any {
  return runtime.projectManager.projectStore.agents.get(agentId);
}

const ZERO_USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function toolCallAssistant(calls: Array<{ id: string; command: string }>): any {
  return {
    role: "assistant",
    content: calls.map((c) => ({
      type: "toolCall",
      id: c.id,
      name: "run_command",
      arguments: { command: c.command },
    })),
    stopReason: "toolUse",
    usage: ZERO_USAGE,
    timestamp: Date.now(),
  };
}

function textAssistant(text: string): any {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: ZERO_USAGE,
    timestamp: Date.now(),
  };
}

function makeStreamFn(responses: any[]): () => any {
  let call = 0;
  return () =>
    (async () => ({
      async *[Symbol.asyncIterator]() {},
      result: async () => responses[Math.min(call++, responses.length - 1)],
    })) as never;
}

function injectAppendFault(
  store: any,
  predicate: (type: string, data: any) => boolean,
  err: Error,
): () => void {
  const real = store.appendEvents.bind(store);
  store.appendEvents = (sessionId: string, events: any[], schemaVersion: number) => {
    if (events.some((e) => predicate(e.type, e.data))) throw err;
    return real(sessionId, events, schemaVersion);
  };
  return () => {
    store.appendEvents = real;
  };
}

const PENDING = Symbol("pending");

async function settleState(p: Promise<unknown>): Promise<typeof PENDING | "fulfilled" | "rejected"> {
  return Promise.race([
    p.then(
      () => "fulfilled" as const,
      () => "rejected" as const,
    ),
    new Promise<typeof PENDING>((resolve) => setTimeout(() => resolve(PENDING), 300)),
  ]);
}

function captureUncaught(fn: () => void): { run: () => void; caught: unknown[] } {
  const caught: unknown[] = [];
  const run = () => {
    const existing = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    const mine = (err: unknown) => caught.push(err);
    process.on("uncaughtException", mine);
    try {
      fn();
    } finally {
      process.off("uncaughtException", mine);
      for (const listener of existing) process.on("uncaughtException", listener);
    }
  };
  return { run, caught };
}

describe("control persistence fault injection (gate -> runner -> storage seam)", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let deps: RuntimeDeps;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-ctrl-fault-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore as any;
    const testAgent = await projectStore.createAgent("fault-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
    deps = {
      projectStore,
      projectRoot: projectStore.getRootPath(),
      fileWriteMutex: (runtime as any).sessionRuntime.deps.fileWriteMutex,
      logger: createSilentLogger(),
      runConfig: new RunConfigHolder({ defaultModel: "openai/gpt-4o" }),
      modelResolver: createModelResolver(stubCatalog),
      modelCatalog: stubCatalog,
      capabilities: builtinToolCapabilities(),
      stores: createStoreRegistry(),
      attachmentProcessors: [],
    } as any;
  });

  afterEach(() => {
    getChatStreamFnMock.mockImplementation(() => vi.fn() as never);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function markerPath(name: string): string {
    return path.join(deps.projectRoot, `${name}.txt`);
  }

  async function setupRunner(): Promise<{ runner: AgentRunner; agentStore: any }> {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = { ...agentStore._profile, yolo: false };
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    return { runner, agentStore };
  }

  function controlEventsOf(recorded: any[], type: string): any[] {
    return recorded.filter((e) => e.type === type);
  }

  it("releases the approved decision only after control/resolved persistence succeeds", async () => {
    getChatStreamFnMock.mockImplementation(
      makeStreamFn([toolCallAssistant([{ id: "tc-1", command: "echo resolve-commit > m1.txt" }]), textAssistant("done")]),
    );
    const { runner, agentStore } = await setupRunner();
    const diskFull = new Error("EIO: simulated disk full on control/resolved append");
    const restore = injectAppendFault(
      agentStore.sessions,
      (type) => type === "control/resolved",
      diskFull,
    );

    try {
      const recorded: any[] = [];
      const run = runner.sendMessage("run it", [], (e) => recorded.push(e));
      run.catch(() => {});
      await vi.waitFor(() => expect(controlEventsOf(recorded, "control_request")).toHaveLength(1));
      const requestId = controlEventsOf(recorded, "control_request")[0].requestId;
      const bus = (runner as any).controlBus;

      expect(() => runner.resolveControlRequest(requestId, { approved: true })).not.toThrow();

      await run.catch(() => {});
      expect(fs.existsSync(markerPath("m1"))).toBe(false);
      expect(bus.pendingCount).toBe(0);
      const log = (runner as any).eventLog.events as any[];
      expect(log.filter((e) => e.type === "control/requested")).toHaveLength(1);
      expect(log.filter((e) => e.type === "control/resolved")).toHaveLength(0);
      const toolResult = log.find(
        (e) => e.type === "tool/result" && e.data?.message?.toolCallId === "tc-1",
      );
      expect(toolResult).toBeDefined();
      expect(JSON.stringify(toolResult.data.message)).toContain("EIO");
    } finally {
      restore();
    }
  });

  it("rejectAll isolates per-entry persistence faults, converges every waiter, and always reaches agent.abort", async () => {
    getChatStreamFnMock.mockImplementation(
      makeStreamFn([
        toolCallAssistant([
          { id: "tc-1", command: "echo one > m1.txt" },
          { id: "tc-2", command: "echo two > m2.txt" },
        ]),
        textAssistant("done"),
      ]),
    );
    const { runner, agentStore } = await setupRunner();

    const recorded: any[] = [];
    const run = runner.sendMessage("run both", [], (e) => recorded.push(e));
    run.catch(() => {});
    await vi.waitFor(() => expect(controlEventsOf(recorded, "control_request")).toHaveLength(2));
    const [first, second] = controlEventsOf(recorded, "control_request");
    const diskFull = new Error("EIO: simulated disk full on aborted resolution append");
    const restore = injectAppendFault(
      agentStore.sessions,
      (type, _data) => type === "control/resolved" && _data?.requestId === first.requestId,
      diskFull,
    );

    try {
      const agent = (runner as any).agentRef;
      const abortSpy = vi.fn();
      agent.abort = abortSpy;
      const bus = (runner as any).controlBus;

      expect(() => runner.abort()).not.toThrow();
      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect(bus.pendingCount).toBe(0);

      await run.catch(() => {});
      expect(fs.existsSync(markerPath("m1"))).toBe(false);
      expect(fs.existsSync(markerPath("m2"))).toBe(false);

      const log = (runner as any).eventLog.events as any[];
      const abortedRecords = log.filter(
        (e) => e.type === "control/resolved" && e.data?.aborted === true,
      );
      expect(abortedRecords.map((e) => e.data.requestId)).toEqual([second.requestId]);
    } finally {
      restore();
    }
  });

  it("UI notification failure after successful control/resolved persistence is not surfaced as a resolve error", async () => {
    getChatStreamFnMock.mockImplementation(
      makeStreamFn([toolCallAssistant([{ id: "tc-1", command: "echo notify-commit > m1.txt" }]), textAssistant("done")]),
    );
    const { runner } = await setupRunner();

    const recorded: any[] = [];
    const run = runner.sendMessage("run it", [], (e) => {
      recorded.push(e);
      if (e.type === "control_resolved") throw new Error("ws notify boom");
    });
    run.catch(() => {});
    await vi.waitFor(() => expect(controlEventsOf(recorded, "control_request")).toHaveLength(1));
    const requestId = controlEventsOf(recorded, "control_request")[0].requestId;

    expect(() => runner.resolveControlRequest(requestId, { approved: true })).not.toThrow();

    await run.catch(() => {});
    const log = (runner as any).eventLog.events as any[];
    expect(log.filter((e) => e.type === "control/resolved" && e.data?.requestId === requestId)).toHaveLength(1);
    expect(fs.existsSync(markerPath("m1"))).toBe(true);
    expect((runner as any).controlBus.pendingCount).toBe(0);
  });

  it("UI notification failure after successful control_request persistence does not fail the gate", async () => {
    getChatStreamFnMock.mockImplementation(
      makeStreamFn([toolCallAssistant([{ id: "tc-1", command: "echo request-commit > m1.txt" }]), textAssistant("done")]),
    );
    const { runner } = await setupRunner();

    const recorded: any[] = [];
    const run = runner.sendMessage("run it", [], (e) => {
      recorded.push(e);
      if (e.type === "control_request") throw new Error("ws notify boom");
    });
    run.catch(() => {});
    await vi.waitFor(() => {
      const log = (runner as any).eventLog.events as any[];
      expect(log.filter((e) => e.type === "control/requested")).toHaveLength(1);
    });
    const bus = (runner as any).controlBus;

    expect(await settleState(run)).toBe(PENDING);
    expect(fs.existsSync(markerPath("m1"))).toBe(false);
    expect(bus.pendingCount).toBe(1);

    const log = (runner as any).eventLog.events as any[];
    const requestId = log.find((e) => e.type === "control/requested").data.requestId;
    expect(() => runner.resolveControlRequest(requestId, { approved: true })).not.toThrow();

    await run.catch(() => {});
    expect(fs.existsSync(markerPath("m1"))).toBe(true);
    expect(bus.pendingCount).toBe(0);
  });

  it("successful approval persists exactly one resolved record and duplicate resolves are no-ops", async () => {
    getChatStreamFnMock.mockImplementation(
      makeStreamFn([toolCallAssistant([{ id: "tc-1", command: "echo happy > m1.txt" }]), textAssistant("done")]),
    );
    const { runner } = await setupRunner();

    const recorded: any[] = [];
    const run = runner.sendMessage("run it", [], (e) => recorded.push(e));
    await vi.waitFor(() => expect(controlEventsOf(recorded, "control_request")).toHaveLength(1));
    const requestId = controlEventsOf(recorded, "control_request")[0].requestId;

    expect(() => runner.resolveControlRequest(requestId, { approved: true })).not.toThrow();
    expect(() => runner.resolveControlRequest(requestId, { approved: false })).not.toThrow();

    await run;
    const log = (runner as any).eventLog.events as any[];
    expect(log.filter((e) => e.type === "control/resolved" && e.data?.requestId === requestId)).toHaveLength(1);
    expect(fs.existsSync(markerPath("m1"))).toBe(true);
    expect((runner as any).controlBus.pendingCount).toBe(0);
  });

  it("healthy abort rejects every waiter, records aborted resolutions, and aborts the agent", async () => {
    getChatStreamFnMock.mockImplementation(
      makeStreamFn([
        toolCallAssistant([
          { id: "tc-1", command: "echo one > m1.txt" },
          { id: "tc-2", command: "echo two > m2.txt" },
        ]),
        textAssistant("done"),
      ]),
    );
    const { runner } = await setupRunner();

    const recorded: any[] = [];
    const run = runner.sendMessage("run both", [], (e) => recorded.push(e));
    run.catch(() => {});
    await vi.waitFor(() => expect(controlEventsOf(recorded, "control_request")).toHaveLength(2));
    const ids = controlEventsOf(recorded, "control_request").map((e) => e.requestId);

    const agent = (runner as any).agentRef;
    const abortSpy = vi.fn();
    agent.abort = abortSpy;
    const bus = (runner as any).controlBus;

    expect(() => runner.abort()).not.toThrow();
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(bus.pendingCount).toBe(0);

    await run.catch(() => {});
    const log = (runner as any).eventLog.events as any[];
    const abortedIds = log
      .filter((e) => e.type === "control/resolved" && e.data?.aborted === true)
      .map((e) => e.data.requestId);
    expect(abortedIds.sort()).toEqual([...ids].sort());
    expect(fs.existsSync(markerPath("m1"))).toBe(false);
    expect(fs.existsSync(markerPath("m2"))).toBe(false);
  });
});

describe("SessionControlBus timer and emit fault paths", () => {
  it("timeout resolution failure is contained: waiter still gets the fail-closed decision, no uncaught exception", async () => {
    vi.useFakeTimers();
    const bus = new SessionControlBus();
    const sinkErr = new Error("EIO: resolved append fails in timer callback");
    bus.setEventSink((e: any) => {
      if (e.type === "control_resolved") throw sinkErr;
    });
    try {
      const decision = bus.request(
        { requestId: "t1", kind: "approval", toolCallId: "tc", toolName: "run_command", args: {} },
        5000,
        { approved: false, reason: "approval timeout" },
      );

      const capture = captureUncaught(() => {
        vi.advanceTimersByTime(5000);
      });
      capture.run();

      await expect(decision).resolves.toEqual({ approved: false, reason: "approval timeout" });
      expect(bus.pendingCount).toBe(0);
      expect(capture.caught).toHaveLength(0);
    } finally {
      bus.setEventSink(null);
      vi.useRealTimers();
    }
  });

  it("request emit failure rejects the gate without dangling pending entry or orphan timeout resolution", async () => {
    vi.useFakeTimers();
    const bus = new SessionControlBus();
    const resolvedEmits: any[] = [];
    const requestErr = new Error("EIO: requested append fails");
    bus.setEventSink((e: any) => {
      if (e.type === "control_request") throw requestErr;
      resolvedEmits.push(e);
    });
    try {
      const gate = bus.request(
        { requestId: "r1", kind: "approval", toolCallId: "tc", toolName: "run_command", args: {} },
        5000,
        { approved: false, reason: "approval timeout" },
      );

      await expect(gate).rejects.toThrow(/EIO/);
      expect(bus.pendingCount).toBe(0);

      vi.advanceTimersByTime(10000);
      expect(resolvedEmits).toHaveLength(0);
    } finally {
      bus.setEventSink(null);
      vi.useRealTimers();
    }
  });

  it("resolve() releases the decision only after the resolved event sink succeeds", async () => {
    const bus = new SessionControlBus();
    const sinkErr = new Error("EIO: resolved append fails");
    bus.setEventSink((e: any) => {
      if (e.type === "control_resolved") throw sinkErr;
    });
    try {
      const gate = bus.request(
        { requestId: "q1", kind: "question", toolCallId: "tc", toolName: "ask_user", args: {} },
        60_000,
        { timedOut: true },
      );

      expect(() => bus.resolve("q1", { answer: "yes", timedOut: false })).not.toThrow();
      await expect(gate).rejects.toThrow(/EIO/);
      expect(bus.pendingCount).toBe(0);
      expect(() => bus.resolve("q1", { answer: "again", timedOut: false })).not.toThrow();
    } finally {
      bus.setEventSink(null);
    }
  });

  it("re-entrant resolve during the resolved emit is a no-op and emits exactly one record", async () => {
    const bus = new SessionControlBus();
    const resolvedEmits: any[] = [];
    bus.setEventSink((e: any) => {
      if (e.type === "control_request") return;
      resolvedEmits.push(e);
      if (resolvedEmits.length === 1) {
        bus.resolve("r1", { approved: true });
      }
    });
    try {
      const gate = bus.request(
        { requestId: "r1", kind: "approval", toolCallId: "tc", toolName: "run_command", args: {} },
        60_000,
        { approved: false, reason: "approval timeout" },
      );

      bus.resolve("r1", { approved: true });
      await expect(gate).resolves.toEqual({ approved: true });
      expect(resolvedEmits).toHaveLength(1);
      expect(bus.pendingCount).toBe(0);
    } finally {
      bus.setEventSink(null);
    }
  });
});
