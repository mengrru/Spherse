import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSilentLogger } from "../logger.js";

const { getChatStreamFnMock, resolveModelByIdMock } = vi.hoisted(() => ({
  getChatStreamFnMock: vi.fn(() => vi.fn()),
  resolveModelByIdMock: vi.fn((modelId: string) => {
    const slashIdx = modelId.indexOf("/");
    return slashIdx >= 0
      ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
      : { id: modelId, provider: modelId };
  }),
}));

vi.mock("../model-providers/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../model-providers/index.js")>();
  return {
    ...actual,
    getChatStreamFn: getChatStreamFnMock,
    resolveModelById: resolveModelByIdMock,
  };
});

import { createProject } from "../factory.js";
import { ModelNotConfiguredError } from "../errors.js";

interface FakeAgent {
  state: { model?: { id: string; provider: string } };
  streamFn: unknown;
  prompt: (message: string) => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
}
interface RuntimeInternals {
  sessionRuntime: {
    activeSessions: Map<string, { agent: FakeAgent; agentId: string }>;
    createSession: (agentId: string) => Promise<string>;
    setTemperature: (t: number | undefined) => void;
    setDefaultModel: (m: string | undefined) => void;
    hasActiveSession: (id: string) => boolean;
  };
  projectManager: { projectStore: { agents: Map<string, unknown> } };
  scheduler: { stopAll: () => void };
}

function activeAgent(runtime: RuntimeInternals, sessionId: string): FakeAgent {
  const entry = runtime.sessionRuntime.activeSessions.get(sessionId);
  if (!entry) throw new Error(`no active session ${sessionId}`);
  return entry.agent;
}

describe("SessionRuntime temperature propagation", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-rt-temp-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      temperature: 0.3,
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    agentId = [...projectStore.agents.keys()][0];
    runtime.scheduler.stopAll();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes constructor temperature to getChatStreamFn on buildAgent", async () => {
    await runtime.sessionRuntime.createSession(agentId);

    expect(getChatStreamFnMock).toHaveBeenCalledTimes(1);
    expect(getChatStreamFnMock).toHaveBeenLastCalledWith(0.3);
  });

  it("updates temperature via setTemperature for subsequent buildAgent", async () => {
    runtime.sessionRuntime.setTemperature(0.5);
    await runtime.sessionRuntime.createSession(agentId);

    expect(getChatStreamFnMock).toHaveBeenLastCalledWith(0.5);
  });

  it("passes undefined after setTemperature(undefined)", async () => {
    runtime.sessionRuntime.setTemperature(undefined);
    await runtime.sessionRuntime.createSession(agentId);

    expect(getChatStreamFnMock).toHaveBeenLastCalledWith(undefined);
  });

  it("hot-swaps streamFn on existing agents when setTemperature is called", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    expect(getChatStreamFnMock).toHaveBeenCalledTimes(1);
    expect(getChatStreamFnMock).toHaveBeenLastCalledWith(0.3);

    runtime.sessionRuntime.setTemperature(0.5);

    // one active agent → one additional getChatStreamFn call for the hot-swap
    expect(getChatStreamFnMock).toHaveBeenCalledTimes(2);
    expect(getChatStreamFnMock).toHaveBeenLastCalledWith(0.5);

    const agent = activeAgent(runtime as RuntimeInternals, sessionId);
    const swappedStreamFn = getChatStreamFnMock.mock.results[1].value;
    expect(agent.streamFn).toBe(swappedStreamFn);
  });

  it("hot-swaps streamFn on ALL active agents (multiple sessions)", async () => {
    const sessionIdA = await runtime.sessionRuntime.createSession(agentId);
    const sessionIdB = await runtime.sessionRuntime.createSession(agentId);
    const sessionIdC = await runtime.sessionRuntime.createSession(agentId);
    const callsBefore = getChatStreamFnMock.mock.calls.length;

    const fnBeforeA = activeAgent(runtime as RuntimeInternals, sessionIdA).streamFn;
    const fnBeforeB = activeAgent(runtime as RuntimeInternals, sessionIdB).streamFn;
    const fnBeforeC = activeAgent(runtime as RuntimeInternals, sessionIdC).streamFn;

    runtime.sessionRuntime.setTemperature(0.9);

    // 3 active agents → 3 additional getChatStreamFn calls, all with 0.9
    expect(getChatStreamFnMock.mock.calls.length).toBe(callsBefore + 3);
    expect(getChatStreamFnMock.mock.calls.slice(callsBefore)).toEqual([[0.9], [0.9], [0.9]]);

    expect(activeAgent(runtime as RuntimeInternals, sessionIdA).streamFn).not.toBe(fnBeforeA);
    expect(activeAgent(runtime as RuntimeInternals, sessionIdB).streamFn).not.toBe(fnBeforeB);
    expect(activeAgent(runtime as RuntimeInternals, sessionIdC).streamFn).not.toBe(fnBeforeC);
  });
});

describe("SessionRuntime default model hot-swap", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-rt-model-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    agentId = [...projectStore.agents.keys()][0];
    runtime.scheduler.stopAll();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("hot-swaps model on active agents using the global default", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    const agent = activeAgent(runtime as RuntimeInternals, sessionId);
    // preset agent has no profile.model and no global default yet → no model resolved
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

    // profile.model wins over global default → unchanged
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

describe("SessionRuntime lazy model resolution", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-rt-lazy-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    agentId = [...projectStore.agents.keys()][0];
    runtime.scheduler.stopAll();
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
      runtime.sessionRuntime.sendMessage(sessionId, "hi", () => {}),
    ).rejects.toBeInstanceOf(ModelNotConfiguredError);
  });

  it("does not throw ModelNotConfiguredError on sendMessage after a model is configured", async () => {
    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    runtime.sessionRuntime.setDefaultModel("openai/gpt-4o");

    const agent = activeAgent(runtime as RuntimeInternals, sessionId);
    agent.subscribe = vi.fn(() => () => {}) as FakeAgent["subscribe"];
    agent.prompt = vi.fn().mockResolvedValue(undefined) as FakeAgent["prompt"];

    await expect(
      runtime.sessionRuntime.sendMessage(sessionId, "hi", () => {}),
    ).resolves.toBeUndefined();
    expect(agent.prompt).toHaveBeenCalledWith("hi");
  });
});
