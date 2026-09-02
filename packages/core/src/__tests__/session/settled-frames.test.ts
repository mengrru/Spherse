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
import { SessionEventLog } from "../../session/event-log.js";
import {
  deriveHistoryEntries,
  projectSettledFrames,
} from "../../session/fold.js";
import type { SessionEvent } from "../../session/events.js";
import { RunConfigHolder, type RuntimeDeps } from "../../session/runtime.js";
import { createModelResolver } from "../../session/model-resolver.js";
import { builtinToolCapabilities } from "../../capabilities/builtin.js";
import { createStoreRegistry } from "../../kernel/ports.js";

const TEST_AGENT_PROFILE = `---
name: Test Agent
tools:
  - read_file
---

Test agent for sessions.`;

interface RuntimeInternals {
  projectManager: { projectStore: { agents: Map<string, unknown> } };
  triggerManager: { stopAll: () => void };
  timerService: { stop: () => void };
}

function agentOf(runner: AgentRunner): any {
  return runner.agentRef;
}

function eventsOf(runner: AgentRunner): any[] {
  return (runner as any).eventLog.events;
}

function ev(
  type: SessionEvent["type"],
  seq: number,
  data: unknown,
): SessionEvent {
  return { type, seq, time: seq, data } as SessionEvent;
}

describe("projectSettledFrames", () => {
  const events: SessionEvent[] = [
    ev("turn/start", 0, {}),
    ev("user/message", 1, { message: { role: "user", content: "q", timestamp: 1 }, intentId: "01J" }),
    ev("assistant/message", 2, { message: { role: "assistant", content: [], stopReason: "stop", timestamp: 2 } }),
    ev("tool/result", 3, { message: { role: "toolResult", toolCallId: "t1", toolName: "read_file", content: [], timestamp: 3 } }),
    ev("turn/end", 4, { reason: "completed" }),
    ev("turn/withdrawn", 5, { seq: 1 }),
    ev("turn/retried", 6, { abandonedSeqs: [2] }),
    ev("compaction/applied", 7, { anchorSeq: 0, digestContent: "d", excludedSeqs: [] }),
  ];

  it("maps message and turn events to settled frames and skips markers", () => {
    const { frames, hasMore } = projectSettledFrames(events, -1, 100);
    expect(hasMore).toBe(false);
    expect(frames).toEqual([
      { type: "message_settled", seq: 1, message: { role: "user", content: "q", timestamp: 1 }, intentId: "01J" },
      { type: "message_settled", seq: 2, message: { role: "assistant", content: [], stopReason: "stop", timestamp: 2 } },
      { type: "message_settled", seq: 3, message: { role: "toolResult", toolCallId: "t1", toolName: "read_file", content: [], timestamp: 3 } },
      { type: "turn_withdrawn", seq: 1, upTo: 5 },
      { type: "turn_retried", seq: 6, abandonedSeqs: [2] },
    ]);
  });

  it("only returns frames whose event seq is greater than since", () => {
    const { frames } = projectSettledFrames(events, 2, 100);
    expect(frames).toEqual([
      { type: "message_settled", seq: 3, message: { role: "toolResult", toolCallId: "t1", toolName: "read_file", content: [], timestamp: 3 } },
      { type: "turn_withdrawn", seq: 1, upTo: 5 },
      { type: "turn_retried", seq: 6, abandonedSeqs: [2] },
    ]);
  });

  it("caps at limit and reports hasMore", () => {
    const { frames, hasMore } = projectSettledFrames(events, -1, 2);
    expect(frames).toHaveLength(2);
    expect(hasMore).toBe(true);
  });

  it("returns empty and no hasMore when nothing follows since", () => {
    const { frames, hasMore } = projectSettledFrames(events, 7, 100);
    expect(frames).toEqual([]);
    expect(hasMore).toBe(false);
  });

  it("omits intentId when the user message carries none", () => {
    const noIntent: SessionEvent[] = [
      ev("user/message", 0, { message: { role: "user", content: "q", timestamp: 1 } }),
    ];
    const { frames } = projectSettledFrames(noIntent, -1, 100);
    expect(frames).toEqual([
      { type: "message_settled", seq: 0, message: { role: "user", content: "q", timestamp: 1 } },
    ]);
  });
});

describe("AgentRunner settled frames", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let deps: RuntimeDeps;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-settled-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore as any;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
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
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createRunner(): Promise<{ runner: AgentRunner; sessionId: string }> {
    const agentStore = (deps.projectStore as any).getAgent(agentId) as any;
    const sessionId = agentStore.sessions.createSession();
    const eventLog = SessionEventLog.open(agentStore.sessions, sessionId);
    const runner = await AgentRunner.init(deps, agentId, sessionId, { eventLog });
    return { runner, sessionId };
  }

  function stubAgentLoopWith(runner: AgentRunner, emit: (listener: (event: any) => void) => void): void {
    const agent = agentOf(runner);
    let capturedListener: ((event: any) => void) | undefined;
    agent.subscribe = vi.fn((listener: any) => {
      capturedListener = listener;
      return () => {};
    }) as never;
    agent.prompt = vi.fn().mockImplementation(async () => {
      emit((event) => capturedListener?.(event));
    }) as never;
    agent.continue = vi.fn().mockResolvedValue(undefined) as never;
  }

  it("emits user message_settled with intentId before transient events and persists intentId", async () => {
    const { runner, sessionId } = await createRunner();
    const seen: any[] = [];
    stubAgentLoopWith(runner, () => {});

    await runner.sendMessage("hello", [], (e) => seen.push(e), { intentId: "01JTEST" });

    const userSettled = seen.filter((e) => e.type === "message_settled");
    expect(userSettled).toEqual([
      {
        type: "message_settled",
        seq: 0,
        message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: expect.any(Number) },
        intentId: "01JTEST",
      },
    ]);
    expect(seen[0].type).toBe("message_settled");

    const userEvent = eventsOf(runner).find((e: any) => e.type === "user/message");
    expect(userEvent.data.intentId).toBe("01JTEST");
    const derived = deriveHistoryEntries(
      ((deps.projectStore as any).getAgent(agentId) as any).sessions.readEvents(sessionId),
    );
    expect(derived[0].intentId).toBe("01JTEST");
  });

  it("stamps persisted seq on assistant message_end and follows it with message_settled", async () => {
    const { runner } = await createRunner();
    const seen: any[] = [];
    const assistantMsg = {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      stopReason: "stop",
      timestamp: Date.now(),
    };
    stubAgentLoopWith(runner, (emit) => {
      emit({ type: "message_start", message: assistantMsg });
      emit({ type: "message_update", message: assistantMsg });
      emit({ type: "message_end", message: assistantMsg });
      emit({ type: "agent_end", messages: [assistantMsg] });
    });

    await runner.sendMessage("hello", [], (e) => seen.push(e));

    const transientEnd = seen.find(
      (e: any) => e.type === "message_end" && e.message?.role === "assistant",
    );
    const persistedSeq = eventsOf(runner).find(
      (e: any) => e.type === "assistant/message",
    )?.seq;
    expect(persistedSeq).toBeDefined();
    expect(transientEnd.seq).toBe(persistedSeq);

    const settled = seen.filter((e: any) => e.type === "message_settled");
    expect(settled).toEqual([
      { type: "message_settled", seq: expect.any(Number), message: expect.any(Object) },
      { type: "message_settled", seq: persistedSeq, message: assistantMsg },
    ]);

    const transientEndIndex = seen.indexOf(transientEnd);
    expect(seen[transientEndIndex + 1]).toBe(settled[1]);
  });

  it("leaves the user transient message_end unstamped", async () => {
    const { runner } = await createRunner();
    const seen: any[] = [];
    const userMsg = { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() };
    stubAgentLoopWith(runner, (emit) => {
      emit({ type: "message_start", message: userMsg });
      emit({ type: "message_end", message: userMsg });
      emit({ type: "agent_end", messages: [] });
    });

    await runner.sendMessage("hello", [], (e) => seen.push(e));

    const userTransientEnd = seen.find(
      (e: any) => e.type === "message_end" && e.message?.role === "user",
    );
    expect(userTransientEnd).toBeDefined();
    expect(userTransientEnd.seq).toBeUndefined();
  });

  it("settles toolResult message_end with the tool/result seq", async () => {
    const { runner } = await createRunner();
    const seen: any[] = [];
    const toolResult = {
      role: "toolResult",
      toolCallId: "t1",
      toolName: "read_file",
      content: [{ type: "text", text: "data" }],
      timestamp: Date.now(),
    };
    stubAgentLoopWith(runner, (emit) => {
      emit({ type: "message_end", message: toolResult });
      emit({ type: "agent_end", messages: [] });
    });

    await runner.sendMessage("hello", [], (e) => seen.push(e));

    const toolSeq = eventsOf(runner).find((e: any) => e.type === "tool/result")?.seq;
    expect(toolSeq).toBeDefined();
    expect(seen).toContainEqual({ type: "message_settled", seq: toolSeq, message: toolResult });
    const transientEnd = seen.find(
      (e: any) => e.type === "message_end" && e.message?.role === "toolResult",
    );
    expect(transientEnd.seq).toBe(toolSeq);
  });

  it("emits turn_retried with the appended event seq before transient events", async () => {
    const { runner } = await createRunner();
    const failed = {
      role: "assistant",
      content: [{ type: "text", text: "boom" }],
      stopReason: "error",
      errorMessage: "provider down",
      timestamp: Date.now(),
    };
    const firstAgent = agentOf(runner);
    stubAgentLoopWith(runner, (emit) => {
      firstAgent.state.messages.push(failed);
      emit({ type: "message_start", message: failed });
      emit({ type: "message_end", message: failed });
      emit({ type: "agent_end", messages: [failed] });
    });
    await runner.sendMessage("hello", [], () => {});

    const seen: any[] = [];
    const retriedMsg = {
      role: "assistant",
      content: [{ type: "text", text: "retry ok" }],
      stopReason: "stop",
      timestamp: Date.now(),
    };
    stubAgentLoopWith(runner, (emit) => {
      emit({ type: "message_start", message: retriedMsg });
      emit({ type: "message_end", message: retriedMsg });
      emit({ type: "agent_end", messages: [retriedMsg] });
    });
    await runner.retryLastTurn((e) => seen.push(e));

    const retriedEvent = eventsOf(runner).find((e: any) => e.type === "turn/retried");
    expect(retriedEvent.data.abandonedSeqs).toHaveLength(1);
    expect(seen[0]).toEqual({
      type: "turn_retried",
      seq: retriedEvent.seq,
      abandonedSeqs: retriedEvent.data.abandonedSeqs,
    });
  });
});
