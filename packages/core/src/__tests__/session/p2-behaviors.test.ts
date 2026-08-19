import { describe, expect, it, vi } from "vitest";
import { createMcpCapability } from "../../capabilities/mcp/index.js";
import { logFromCompaction } from "../../session/compactor.js";
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
  it("logFromCompaction drops orphan toolResults and failed assistant turns from the tail", () => {
    const orphanToolResult = {
      id: 101,
      message: { role: "toolResult", toolCallId: "ghost", content: [], timestamp: 1 } as never,
    };
    const failedAssistant = {
      id: 102,
      message: { role: "assistant", content: [], stopReason: "error", timestamp: 2 } as never,
    };
    const goodUser = {
      id: 103,
      message: { role: "user", content: "hi", timestamp: 3 } as never,
    };

    const log = logFromCompaction(100, "digest", 0, [orphanToolResult, failedAssistant, goodUser]);

    expect(log.entries).toHaveLength(2);
    expect(log.entries.map((e) => e.dbId)).toEqual([100, 103]);
    expect((log.entries[1].message as { content: string }).content).toBe("hi");
  });

  it("logFromCompaction keeps matched toolCall/toolResult pairs", () => {
    const assistant = {
      id: 201,
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc1", name: "read_file", arguments: {} }],
        stopReason: "stop",
        timestamp: 1,
      } as never,
    };
    const toolResult = {
      id: 202,
      message: { role: "toolResult", toolCallId: "tc1", content: [], timestamp: 2 } as never,
    };

    const log = logFromCompaction(200, "digest", 0, [assistant, toolResult]);
    expect(log.entries.map((e) => e.dbId)).toEqual([200, 201, 202]);
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
