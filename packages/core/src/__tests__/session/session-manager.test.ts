import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSilentLogger } from "../../logger.js";
import { ModelNotConfiguredError } from "../../errors.js";

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

const TEST_AGENT_PROFILE = `---
name: Test Agent
tools:
  - read_file
---

Test agent for sessions.`;

interface FakeAgent {
  state: { model: { id: string; provider: string } };
  streamFunction: unknown;
  subscribe: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
}
interface RuntimeInternals {
  sessionRuntime: {
    sessions: Map<string, { getAgentId(): string }>;
  };
  projectManager: { projectStore: { agents: Map<string, unknown> } };
  timerService: { stop: () => void };
}

function activeAgent(runtime: RuntimeInternals, sessionId: string): any {
  const entry = (runtime.sessionRuntime as any).sessions.get(sessionId);
  if (!entry) throw new Error(`no active session ${sessionId}`);
  return (entry as any).runner.agentRef;
}

describe("SessionManager temperature propagation", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mgr-temp-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      sampling: { temperature: 0.3 },
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes constructor sampling.temperature to getChatStreamFn on buildAgent", async () => {
    await runtime.sessionRuntime.createSession(agentId);

    expect(getChatStreamFnMock).toHaveBeenCalledTimes(1);
    expect(getChatStreamFnMock).toHaveBeenLastCalledWith({ temperature: 0.3 });
  });

  it("updates temperature via setSampling for subsequent buildAgent", async () => {
    runtime.sessionRuntime.setSampling({ temperature: 0.5 });
    await runtime.sessionRuntime.createSession(agentId);

    expect(getChatStreamFnMock).toHaveBeenLastCalledWith({ temperature: 0.5 });
  });

  it("passes undefined after setSampling(undefined)", async () => {
    runtime.sessionRuntime.setSampling(undefined);
    await runtime.sessionRuntime.createSession(agentId);

    expect(getChatStreamFnMock).toHaveBeenLastCalledWith(undefined);
  });

  it("hot-swaps streamFn on existing agents when setSampling is called", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    expect(getChatStreamFnMock).toHaveBeenCalledTimes(1);
    expect(getChatStreamFnMock).toHaveBeenLastCalledWith({ temperature: 0.3 });

    runtime.sessionRuntime.setSampling({ temperature: 0.5 });

    expect(getChatStreamFnMock).toHaveBeenCalledTimes(2);
    expect(getChatStreamFnMock).toHaveBeenLastCalledWith({ temperature: 0.5 });

    const agent = activeAgent(runtime as RuntimeInternals, sessionId);
    const swappedStreamFn = getChatStreamFnMock.mock.results[1].value;
    const streamFn = agent.streamFunction as (m: unknown, c: unknown, o: Record<string, unknown>) => void;
    streamFn(undefined, undefined, {});
    expect(swappedStreamFn).toHaveBeenCalledWith(undefined, undefined, { maxRetries: 1 });
  });

  it("hot-swaps streamFn on ALL active agents (multiple sessions)", async () => {
    const sessionIdA = await runtime.sessionRuntime.createSession(agentId);
    const sessionIdB = await runtime.sessionRuntime.createSession(agentId);
    const sessionIdC = await runtime.sessionRuntime.createSession(agentId);
    const callsBefore = getChatStreamFnMock.mock.calls.length;

    const fnBeforeA = activeAgent(runtime as RuntimeInternals, sessionIdA).streamFunction;
    const fnBeforeB = activeAgent(runtime as RuntimeInternals, sessionIdB).streamFunction;
    const fnBeforeC = activeAgent(runtime as RuntimeInternals, sessionIdC).streamFunction;

    runtime.sessionRuntime.setSampling({ temperature: 0.9 });

    expect(getChatStreamFnMock.mock.calls.length).toBe(callsBefore + 3);
    expect(getChatStreamFnMock.mock.calls.slice(callsBefore)).toEqual([
      [{ temperature: 0.9 }],
      [{ temperature: 0.9 }],
      [{ temperature: 0.9 }],
    ]);

    expect(activeAgent(runtime as RuntimeInternals, sessionIdA).streamFunction).not.toBe(fnBeforeA);
    expect(activeAgent(runtime as RuntimeInternals, sessionIdB).streamFunction).not.toBe(fnBeforeB);
    expect(activeAgent(runtime as RuntimeInternals, sessionIdC).streamFunction).not.toBe(fnBeforeC);
  });
});

describe("SessionManager sampling (temperature + topP) propagation", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mgr-topp-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      sampling: { temperature: 0.3, topP: 0.8 },
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes constructor sampling to getChatStreamFn on buildAgent", async () => {
    await runtime.sessionRuntime.createSession(agentId);

    expect(getChatStreamFnMock).toHaveBeenCalledTimes(1);
    expect(getChatStreamFnMock).toHaveBeenLastCalledWith({ temperature: 0.3, topP: 0.8 });
  });

  it("updates topP via setSampling while preserving temperature", async () => {
    runtime.sessionRuntime.setSampling({ temperature: 0.3, topP: 0.5 });
    await runtime.sessionRuntime.createSession(agentId);

    expect(getChatStreamFnMock).toHaveBeenLastCalledWith({ temperature: 0.3, topP: 0.5 });
  });

  it("passes undefined sampling after setSampling(undefined)", async () => {
    runtime.sessionRuntime.setSampling(undefined);
    await runtime.sessionRuntime.createSession(agentId);

    expect(getChatStreamFnMock).toHaveBeenLastCalledWith(undefined);
  });

  it("hot-swaps streamFn on existing agents when setSampling is called", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    expect(getChatStreamFnMock).toHaveBeenLastCalledWith({ temperature: 0.3, topP: 0.8 });

    runtime.sessionRuntime.setSampling({ temperature: 0.3, topP: 0.1 });

    expect(getChatStreamFnMock).toHaveBeenLastCalledWith({ temperature: 0.3, topP: 0.1 });

    const agent = activeAgent(runtime as RuntimeInternals, sessionId);
    const swappedStreamFn = getChatStreamFnMock.mock.results[1].value;
    const streamFn = agent.streamFunction as (m: unknown, c: unknown, o: Record<string, unknown>) => void;
    streamFn(undefined, undefined, {});
    expect(swappedStreamFn).toHaveBeenCalledWith(undefined, undefined, { maxRetries: 1 });
  });
});

describe("SessionManager default model hot-swap", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mgr-model-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("hot-swaps model on active agents using the global default", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    const agent = activeAgent(runtime as RuntimeInternals, sessionId);
    expect(resolveModelByIdMock).not.toHaveBeenCalled();

    runtime.sessionRuntime.setDefaultModel("openai/gpt-4o");

    expect(agent.state.model?.id).toBe("gpt-4o");
    expect(agent.state.model?.provider).toBe("openai");
  });

  it("does not override agents whose profile pins a specific model", async () => {
    const projectStore = runtime.projectManager.projectStore;
    const agentStore = projectStore.agents.get(agentId) as {
      _profile: { model?: string };
    };
    agentStore._profile = { ...agentStore._profile, model: "custom/pinned" };

    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    const agent = activeAgent(runtime as RuntimeInternals, sessionId);
    expect(agent.state.model?.id).toBe("pinned");

    runtime.sessionRuntime.setDefaultModel("openai/gpt-4o");

    expect(agent.state.model?.id).toBe("pinned");
    expect(agent.state.model?.provider).toBe("custom");
  });

  it("hot-swaps model on ALL active agents (multiple sessions)", async () => {
    const sessionIdA = await runtime.sessionRuntime.createSession(agentId);
    const sessionIdB = await runtime.sessionRuntime.createSession(agentId);
    const sessionIdC = await runtime.sessionRuntime.createSession(agentId);

    runtime.sessionRuntime.setDefaultModel("openai/gpt-4o");

    for (const sid of [sessionIdA, sessionIdB, sessionIdC]) {
      const agent = activeAgent(runtime as RuntimeInternals, sid);
      expect(agent.state.model?.id).toBe("gpt-4o");
      expect(agent.state.model?.provider).toBe("openai");
    }
  });
});

describe("SessionManager lazy model resolution", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mgr-lazy-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds an agent without a model when none is configured", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    expect(sessionId).toBeDefined();
    expect(resolveModelByIdMock).not.toHaveBeenCalled();
  });

  it("treats an empty-string globalDefaultModel as unconfigured", async () => {
    runtime.sessionRuntime.setDefaultModel("");
    await runtime.sessionRuntime.createSession(agentId);
    expect(resolveModelByIdMock).not.toHaveBeenCalled();
  });

  it("throws ModelNotConfiguredError on sendMessage when no model is configured", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    await expect(
      runtime.sessionRuntime.sendMessage(sessionId, "hi", [], () => {}),
    ).rejects.toBeInstanceOf(ModelNotConfiguredError);
  });

  it("does not throw ModelNotConfiguredError on sendMessage after a model is configured", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    runtime.sessionRuntime.setDefaultModel("openai/gpt-4o");

    const agent = activeAgent(runtime as RuntimeInternals, sessionId);
    agent.subscribe = vi.fn(() => () => {}) as FakeAgent["subscribe"];
    agent.prompt = vi.fn().mockResolvedValue(undefined) as FakeAgent["prompt"];

    await expect(
      runtime.sessionRuntime.sendMessage(sessionId, "hi", [], () => {}),
    ).resolves.toBeUndefined();
    expect(agent.prompt).toHaveBeenCalledTimes(1);
    const promptArg = (agent.prompt as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(promptArg.role).toBe("user");
    expect(promptArg.content).toEqual([{ type: "text", text: "hi" }]);
  });
});

describe("SessionManager lifecycle", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mgr-life-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("hasActiveSession reflects create/destroy", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    expect(runtime.sessionRuntime.hasActiveSession(sessionId)).toBe(true);
    runtime.sessionRuntime.destroySession(sessionId);
    expect(runtime.sessionRuntime.hasActiveSession(sessionId)).toBe(false);
  });

  it("restoreSession is idempotent for an already-active session", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    const before = runtime.sessionRuntime.sessions.size;
    await runtime.sessionRuntime.restoreSession(agentId, sessionId);
    expect(runtime.sessionRuntime.sessions.size).toBe(before);
  });

  it("evictAgent removes all sessions for that agent", async () => {
    const sidA = await runtime.sessionRuntime.createSession(agentId);
    const sidB = await runtime.sessionRuntime.createSession(agentId);
    expect(runtime.sessionRuntime.hasActiveSession(sidA)).toBe(true);
    expect(runtime.sessionRuntime.hasActiveSession(sidB)).toBe(true);

    runtime.sessionRuntime.evictAgent(agentId);

    expect(runtime.sessionRuntime.hasActiveSession(sidA)).toBe(false);
    expect(runtime.sessionRuntime.hasActiveSession(sidB)).toBe(false);
  });

  it("closeAll removes every session", async () => {
    const sidA = await runtime.sessionRuntime.createSession(agentId);
    const sidB = await runtime.sessionRuntime.createSession(agentId);

    runtime.sessionRuntime.closeAll();

    expect(runtime.sessionRuntime.hasActiveSession(sidA)).toBe(false);
    expect(runtime.sessionRuntime.hasActiveSession(sidB)).toBe(false);
    expect(runtime.sessionRuntime.sessions.size).toBe(0);
  });
});

describe("SessionManager getSessionStatus", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mgr-status-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns in-memory status for a live session", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    const agent = activeAgent(runtime as RuntimeInternals, sessionId);
    agent.state.model = { id: "m", provider: "p", contextWindow: 128000 };
    agent.state.messages = [
      { role: "user", content: "hi" },
      { role: "assistant", usage: { totalTokens: 512 } },
    ];

    const status = runtime.sessionRuntime.getSessionStatus(agentId, sessionId);
    expect(status).toEqual({ currentTokens: 512, contextWindowLimit: 128000 });
  });

  it("computes status from persisted history for a non-live session", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    const agentStore = runtime.projectManager.projectStore.agents.get(agentId) as any;
    agentStore.sessions.appendMessage(sessionId, {
      role: "assistant",
      usage: { totalTokens: 999 },
    });
    runtime.sessionRuntime.destroySession(sessionId);
    expect(runtime.sessionRuntime.hasActiveSession(sessionId)).toBe(false);

    resolveModelByIdMock.mockReturnValueOnce({ id: "m", provider: "p", contextWindow: 64000 });
    runtime.sessionRuntime.setDefaultModel("p/m");

    const status = runtime.sessionRuntime.getSessionStatus(agentId, sessionId);
    expect(status).toEqual({ currentTokens: 999, contextWindowLimit: 64000 });
  });

  it("throws NotFoundError for an unknown agent on the non-live path", async () => {
    expect(() => runtime.sessionRuntime.getSessionStatus("nope", "sid")).toThrow(/Agent "nope" not found/);
  });

  it("throws NotFoundError for an unknown session on the non-live path", async () => {
    expect(() => runtime.sessionRuntime.getSessionStatus(agentId, "missing-sid")).toThrow(
      /Session "missing-sid" not found/,
    );
  });
});

describe("SessionManager agent hot-reload", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mgr-reload-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runnerOf(sessionId: string): any {
    const live = (runtime.sessionRuntime as any).sessions.get(sessionId);
    if (!live) throw new Error(`no live session ${sessionId}`);
    return live.runner;
  }

  function liveOf(sessionId: string): any {
    return runnerOf(sessionId);
  }

  const UPDATED_CONTENT = `---
name: Test Agent
tools:
  - read_file
---

Reloaded prompt body.`;

  it("marks a live session pending reload when its agent profile is updated", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    const live = liveOf(sessionId);
    expect(live.pendingReload).toBe(false);

    await runtime.projectManager.projectStore.updateAgent(agentId, UPDATED_CONTENT);

    expect(live.pendingReload).toBe(true);
  });

  it("marks all live sessions sharing the updated agent", async () => {
    const sidA = await runtime.sessionRuntime.createSession(agentId);
    const sidB = await runtime.sessionRuntime.createSession(agentId);

    await runtime.projectManager.projectStore.updateAgent(agentId, UPDATED_CONTENT);

    expect(liveOf(sidA).pendingReload).toBe(true);
    expect(liveOf(sidB).pendingReload).toBe(true);
  });

  it("does not mark sessions belonging to a different agent", async () => {
    const otherAgent = await runtime.projectManager.projectStore.createAgent(
      "other-agent",
      TEST_AGENT_PROFILE,
    );
    const otherId = otherAgent.getProfile().id;
    const sidTarget = await runtime.sessionRuntime.createSession(agentId);
    const sidOther = await runtime.sessionRuntime.createSession(otherId);

    await runtime.projectManager.projectStore.updateAgent(agentId, UPDATED_CONTENT);

    expect(liveOf(sidTarget).pendingReload).toBe(true);
    expect(liveOf(sidOther).pendingReload).toBe(false);
  });

  it("does not mark sessions on agent creation", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    const live = liveOf(sessionId);

    await runtime.projectManager.projectStore.createAgent("new-agent", TEST_AGENT_PROFILE);

    expect(live.pendingReload).toBe(false);
  });
});

describe("SessionManager createSession title", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mgr-title-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists the title on the created session", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId, undefined, "Trip Plan");

    const session = runtime.projectManager.listSessions(agentId).find((s) => s.id === sessionId);
    expect(session?.title).toBe("Trip Plan");
    expect(session?.source).toBe("manual");
  });

  it("keeps the title unset when not provided", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);

    const session = runtime.projectManager.listSessions(agentId).find((s) => s.id === sessionId);
    expect(session?.title).toBeUndefined();
  });

  it("keeps source and title independent", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId, "triggered", "Named");

    const session = runtime.projectManager.listSessions(agentId).find((s) => s.id === sessionId);
    expect(session?.title).toBe("Named");
    expect(session?.source).toBe("triggered");
  });
});
