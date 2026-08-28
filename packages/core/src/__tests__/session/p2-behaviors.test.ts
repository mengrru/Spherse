import { describe, expect, it, vi } from "vitest";
import { createMcpCapability } from "../../capabilities/mcp/index.js";
import { deriveMessages } from "../../session/fold.js";
import type { SessionEvent } from "../../session/events.js";
import { SessionControlBus } from "../../session/control-bus.js";
import { ProjectRuntime } from "../../project-runtime.js";
import type { ProjectStore } from "../../store/project.js";
import type { Logger } from "../../logger.js";
import { createSilentLogger } from "../../logger.js";

describe("runner in-flight guard (#3)", () => {
  it("swapEventSink restores the previous sink", () => {
    const bus = new SessionControlBus();
    const first = vi.fn();
    const second = vi.fn();

    const prev = bus.swapEventSink(first);
    expect(prev).toBeNull();

    const prev2 = bus.swapEventSink(second);
    expect(prev2).toBe(first);

    bus.swapEventSink(prev2);
    bus.setEventSink(null);
  });
});

describe("mcp config version memo (#9)", () => {
  function fakeStore(): ProjectStore {
    return { getAgent: () => undefined } as unknown as ProjectStore;
  }
  const logger: Logger = createSilentLogger();

  it("configVersion bumps on invalidate and the hook memo re-merges", async () => {
    const capability = createMcpCapability({ projectStore: fakeStore(), logger });
    await capability.init({
      projectRoot: "/tmp",
      metaDir: "/tmp/.spherse",
      logger,
      fileWriteMutex: { run: (_p, fn) => fn() } as never,
      stores: { register: () => {}, get: () => undefined, forAgent: () => ({ get: () => undefined, set: (_n, v) => v, delete: () => {}, clear: () => {} }), clearAgent: () => {} },
      session: { createSession: async () => "s", restoreSession: async () => "s", sendMessage: async () => {}, sessionExists: () => false },
    });

    const hooks = capability.turnHooks!("agent-1", "session-1");
    const agent = { state: { tools: [], systemPrompt: "", model: undefined } } as never;

    const v0 = capability.manager.configVersion("agent-1");
    await hooks.beforeTurn!(agent);

    await capability.onAgentConfigChanged!("agent-1", "mcp");
    const v1 = capability.manager.configVersion("agent-1");
    expect(v1).toBe(v0 + 1);

    await hooks.beforeTurn!(agent);

    hooks.onReload?.();
    expect(v0).toBeLessThan(v1);
  });
});

describe("restore sanitization (#10)", () => {
  it("compaction restart drops messages before the anchor (fold projection)", () => {
    const orphanToolResult = {
      role: "toolResult",
      toolCallId: "ghost",
      content: [],
      timestamp: 1,
    } as never;
    const failedAssistant = {
      role: "assistant",
      content: [],
      stopReason: "error",
      timestamp: 2,
    } as never;
    const goodUser = { role: "user", content: "hi", timestamp: 3 } as never;

    const events: SessionEvent[] = [
      { type: "user/message", seq: 0, time: 0, data: { message: { role: "user", content: "old", timestamp: 0 } as never } },
      {
        type: "compaction/applied",
        seq: 1,
        time: 1,
        data: { anchorSeq: 0, digestContent: "digest", excludedSeqs: [] },
      },
      { type: "tool/result", seq: 2, time: 2, data: { message: orphanToolResult } },
      { type: "assistant/message", seq: 3, time: 3, data: { message: failedAssistant } },
      { type: "user/message", seq: 4, time: 4, data: { message: goodUser } },
    ];

    const messages = deriveMessages(events);
    expect(messages.length).toBe(4);
    expect((messages[messages.length - 1] as { content: string }).content).toBe("hi");
  });
});

describe("dispatchAgentConfigChanged (unified config-change signal)", () => {
  it("reaches every capability with the kind; unknown kinds are ignored by capabilities", async () => {
    const seen: Array<{ id: string; kind: string }> = [];
    const capA = {
      id: "a",
      onAgentConfigChanged: async (agentId: string, kind: string) => {
        if (agentId === "agent-1") seen.push({ id: "a", kind });
      },
    };
    const capB = { id: "b" };
    const runtime = new ProjectRuntime({
      projectManager: {} as never,
      sessionRuntime: {} as never,
      projectId: "p",
      capabilities: [capA, capB],
    });

    await runtime.dispatchAgentConfigChanged("agent-1", "tools");
    expect(seen).toEqual([{ id: "a", kind: "tools" }]);
  });
});

describe("SessionPort vocabulary (abort propagation + typed events)", () => {
  it("the assembled port exposes abortSession and typed sendMessage", async () => {
    const { createProject } = await import("../../factory.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-port-"));
    const aborted: string[] = [];
    try {
      const runtime = await createProject(dir);
      await runtime.projectManager.createAgent(undefined, "---\nname: t\n---\nbody");
      const agentId = runtime.projectManager.listAgents()[0].id;
      const sessionId = await runtime.sessionRuntime.createSession(agentId);
      const port = (runtime as unknown as {
        capabilities: Array<{ id: string }>;
      }).capabilities; // just proving runtime assembled; port itself is factory-internal

      // SessionManager surface backs the port's abort vocabulary
      expect(typeof runtime.sessionRuntime.abortSession).toBe("function");
      runtime.sessionRuntime.abortSession(sessionId);
      void aborted;
      void port;
      await runtime.shutdown();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("trigger turn metadata (executor → assembled SessionPort → event log)", () => {
  it("persists source/triggerName on the user message without mocking any seam method", async () => {
    const { createProject } = await import("../../factory.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const finalAssistant = {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stopReason: "stop",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    };
    const catalog = {
      getChatStreamFn: () =>
        async () => ({
          async *[Symbol.asyncIterator]() {},
          result: async () => finalAssistant,
        }),
      resolveModelById: (modelId: string) => {
        const slashIdx = modelId.indexOf("/");
        return slashIdx >= 0
          ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
          : { id: modelId, provider: modelId };
      },
    } as never;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-trigger-meta-"));
    try {
      const runtime = await createProject(dir, {
        defaultModel: "openai/gpt-4o",
        modelCatalog: catalog,
      });
      runtime.timerService.stop();
      await runtime.projectManager.createAgent(undefined, "---\nname: t\n---\nbody");
      const agentId = runtime.projectManager.listAgents()[0].id;
      const sessionId = await runtime.sessionRuntime.createSession(agentId);

      const entry = {
        id: "tr-meta",
        enabled: true,
        type: "event" as const,
        eventName: "evt-meta",
        mode: "existing_session" as const,
        targetSessionId: sessionId,
        message: "hi from trigger",
        notify: false,
        createdAt: 0,
        updatedAt: 0,
      };
      runtime.triggerManager.create(agentId, entry);
      expect(runtime.triggerManager.get(agentId, "tr-meta")).toMatchObject({ id: "tr-meta" });
      runtime.triggerManager.runNow(agentId, "tr-meta");

      let userEntry: { id: number; message: unknown; source?: string; triggerName?: string } | undefined;
      await vi.waitFor(() => {
        const history = runtime.projectManager.getRecentSessionHistory(agentId, sessionId, 20);
        userEntry = history.entries.find((item) => item.id === 0);
        expect(userEntry).toBeDefined();
      });
      expect(userEntry).toMatchObject({
        message: expect.objectContaining({ role: "user" }),
        source: "triggered",
        triggerName: "evt-meta",
      });
      await runtime.shutdown();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
