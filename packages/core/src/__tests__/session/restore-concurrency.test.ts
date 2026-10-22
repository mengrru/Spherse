import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSilentLogger } from "../../logger.js";
import { NotFoundError } from "../../errors.js";

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
import type { Capability } from "../../kernel/capability.js";

const TEST_AGENT_PROFILE = `---
name: Test Agent
tools:
  - read_file
---

Test agent for sessions.`;

interface RuntimeInternals {
  sessionRuntime: {
    sessions: Map<string, { getAgentId(): string }>;
    restoreSession(agentId: string, sessionId: string): Promise<string>;
    sendMessage(
      sessionId: string,
      message: string,
      attachments: [],
      onEvent: () => void,
    ): Promise<void>;
    abortSession(sessionId: string): void;
    destroySession(sessionId: string): void;
    evictAgent(agentId: string): void;
    closeAll(): Promise<void>;
    hasActiveSession(sessionId: string): boolean;
    sessionExists(agentId: string, sessionId: string): boolean;
    setDefaultModel(model: string | undefined): void;
  };
  projectManager: {
    projectStore: {
      agents: Map<string, { sessions: { createSession(title?: string): string } }>;
    };
    deleteSession(agentId: string, sessionId: string): void;
  };
  timerService: { stop: () => void };
}

function activeAgent(runtime: RuntimeInternals, sessionId: string): any {
  const entry = runtime.sessionRuntime.sessions.get(sessionId);
  if (!entry) throw new Error(`no active session ${sessionId}`);
  return (entry as any).agentRef;
}

function createRestoreGate() {
  const builds: string[] = [];
  let attempts = 0;
  let holdAll = false;
  const heldSessions = new Set<string>();
  const waiting: Array<() => void> = [];
  const capability: Capability = {
    id: "test-restore-gate",
    tools: () => {
      attempts += 1;
      return [];
    },
    contextBlocks: async (host) => {
      builds.push(host.sessionId);
      if (holdAll || heldSessions.has(host.sessionId)) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      return [];
    },
  };
  return {
    capability,
    attempts: () => attempts,
    buildsFor: (sessionId: string) => builds.filter((s) => s === sessionId).length,
    heldCount: () => waiting.length,
    holdAll: () => {
      holdAll = true;
    },
    holdSession: (sessionId: string) => {
      heldSessions.add(sessionId);
    },
    releaseOne: () => {
      waiting.shift()?.();
    },
    releaseAll: () => {
      holdAll = false;
      heldSessions.clear();
      while (waiting.length > 0) waiting.shift()?.();
    },
  };
}

describe("SessionManager concurrent restore (single-flight)", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let agentId: string;
  let gate: ReturnType<typeof createRestoreGate>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-restore-race-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    gate = createRestoreGate();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
      capabilities: (builtin) => [...builtin, gate.capability],
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const seedColdSession = (): string => {
    const agentStore = runtime.projectManager.projectStore.agents.get(agentId)!;
    return agentStore.sessions.createSession();
  };

  it("concurrent restores of a cold session share one initialization and publish one runner", async () => {
    const sessionId = seedColdSession();
    gate.holdAll();

    const first = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    const second = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    await vi.waitFor(() => expect(gate.heldCount()).toBeGreaterThanOrEqual(1));
    gate.releaseAll();
    await expect(first).resolves.toBe(sessionId);
    await expect(second).resolves.toBe(sessionId);

    expect(gate.buildsFor(sessionId)).toBe(1);
    expect(gate.attempts()).toBe(1);
    expect(runtime.sessionRuntime.sessions.size).toBe(1);

    const runner = runtime.sessionRuntime.sessions.get(sessionId);
    await runtime.sessionRuntime.restoreSession(agentId, sessionId);
    expect(runtime.sessionRuntime.sessions.get(sessionId)).toBe(runner);
    expect(gate.buildsFor(sessionId)).toBe(1);
  });

  it("keeps the first published instance serving a turn started while a lagging restore settles; abort reaches the running instance", async () => {
    const sessionId = seedColdSession();
    gate.holdAll();

    const first = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    const lagging = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    await vi.waitFor(() => expect(gate.heldCount()).toBeGreaterThanOrEqual(1));
    gate.releaseOne();
    await Promise.race([first, lagging]);
    expect(runtime.sessionRuntime.sessions.size).toBe(1);

    runtime.sessionRuntime.setDefaultModel("openai/gpt-4o");
    const agent = activeAgent(runtime, sessionId);
    const publishedRunner = runtime.sessionRuntime.sessions.get(sessionId);
    agent.subscribe = vi.fn(() => () => {}) as never;
    let finishPrompt!: () => void;
    agent.prompt = vi.fn(
      () => new Promise<void>((resolve) => {
        finishPrompt = resolve;
      }),
    ) as never;
    agent.abort = vi.fn() as never;
    const turn = runtime.sessionRuntime.sendMessage(sessionId, "hi", [], () => {});
    await vi.waitFor(() => expect(agent.prompt).toHaveBeenCalled());

    gate.releaseAll();
    await Promise.all([first, lagging]);

    expect(gate.buildsFor(sessionId)).toBe(1);
    expect(runtime.sessionRuntime.sessions.get(sessionId)).toBe(publishedRunner);

    runtime.sessionRuntime.abortSession(sessionId);
    expect(agent.abort).toHaveBeenCalledTimes(1);

    finishPrompt();
    await turn;
  });

  it("rejects every waiter with the same failure when initialization fails, and a retry initializes fresh", async () => {
    const sessionId = seedColdSession();
    const indexPath = path.join(tmpDir, "AGENTS.md");
    fs.rmSync(indexPath);
    fs.mkdirSync(indexPath);

    const first = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    const second = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    const firstError = await first.then(
      () => {
        throw new Error("expected rejection");
      },
      (err: unknown) => err,
    );
    const secondError = await second.then(
      () => {
        throw new Error("expected rejection");
      },
      (err: unknown) => err,
    );
    expect(secondError).toBe(firstError);
    expect(runtime.sessionRuntime.hasActiveSession(sessionId)).toBe(false);
    expect(gate.attempts()).toBe(1);

    fs.rmSync(indexPath, { recursive: true });
    fs.writeFileSync(indexPath, "", "utf-8");
    await expect(runtime.sessionRuntime.restoreSession(agentId, sessionId)).resolves.toBe(
      sessionId,
    );
    expect(gate.attempts()).toBe(2);
    expect(gate.buildsFor(sessionId)).toBe(1);
    expect(runtime.sessionRuntime.hasActiveSession(sessionId)).toBe(true);
  });

  it("restores independent sessions in parallel without global serialization", async () => {
    const heldSession = seedColdSession();
    const freeSession = seedColdSession();
    gate.holdSession(heldSession);

    const held = runtime.sessionRuntime.restoreSession(agentId, heldSession);
    await vi.waitFor(() => expect(gate.heldCount()).toBeGreaterThanOrEqual(1));
    await expect(
      runtime.sessionRuntime.restoreSession(agentId, freeSession),
    ).resolves.toBe(freeSession);
    expect(runtime.sessionRuntime.hasActiveSession(freeSession)).toBe(true);
    expect(runtime.sessionRuntime.hasActiveSession(heldSession)).toBe(false);

    gate.releaseAll();
    await expect(held).resolves.toBe(heldSession);
    expect(gate.buildsFor(heldSession)).toBe(1);
    expect(gate.buildsFor(freeSession)).toBe(1);
  });

  it("destroySession during initialization discards the runner and fails all waiters; a later retry can publish", async () => {
    const sessionId = seedColdSession();
    gate.holdAll();

    const first = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    const second = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    await vi.waitFor(() => expect(gate.heldCount()).toBeGreaterThanOrEqual(1));
    runtime.sessionRuntime.destroySession(sessionId);
    gate.releaseAll();

    await expect(first).rejects.toBeInstanceOf(NotFoundError);
    await expect(second).rejects.toBeInstanceOf(NotFoundError);
    expect(runtime.sessionRuntime.hasActiveSession(sessionId)).toBe(false);
    expect(gate.attempts()).toBe(1);

    await expect(runtime.sessionRuntime.restoreSession(agentId, sessionId)).resolves.toBe(
      sessionId,
    );
    expect(runtime.sessionRuntime.hasActiveSession(sessionId)).toBe(true);
  });

  it("evictAgent during initialization discards pending restores of that agent only", async () => {
    const otherAgent = await runtime.projectManager.projectStore.createAgent(
      "other-agent",
      TEST_AGENT_PROFILE,
    );
    const otherAgentId = otherAgent.getProfile().id;
    const evictedSession = seedColdSession();
    const otherStore = runtime.projectManager.projectStore.agents.get(otherAgentId)!;
    const otherSession = otherStore.sessions.createSession();
    gate.holdAll();

    const evicted = runtime.sessionRuntime.restoreSession(agentId, evictedSession);
    const untouched = runtime.sessionRuntime.restoreSession(otherAgentId, otherSession);
    await vi.waitFor(() => expect(gate.heldCount()).toBeGreaterThanOrEqual(2));
    runtime.sessionRuntime.evictAgent(agentId);
    gate.releaseAll();

    await expect(evicted).rejects.toBeInstanceOf(NotFoundError);
    await expect(untouched).resolves.toBe(otherSession);
    expect(runtime.sessionRuntime.hasActiveSession(evictedSession)).toBe(false);
    expect(runtime.sessionRuntime.hasActiveSession(otherSession)).toBe(true);
  });

  it("closeAll during initialization fails all pending restores", async () => {
    const sessionId = seedColdSession();
    gate.holdAll();

    const first = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    const second = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    await vi.waitFor(() => expect(gate.heldCount()).toBeGreaterThanOrEqual(1));
    await runtime.sessionRuntime.closeAll();
    gate.releaseAll();

    await expect(first).rejects.toBeInstanceOf(NotFoundError);
    await expect(second).rejects.toBeInstanceOf(NotFoundError);
    expect(runtime.sessionRuntime.hasActiveSession(sessionId)).toBe(false);
  });

  it("a restore for a different agent neither joins nor disturbs an in-flight restore", async () => {
    const otherAgent = await runtime.projectManager.projectStore.createAgent(
      "other-agent",
      TEST_AGENT_PROFILE,
    );
    const otherAgentId = otherAgent.getProfile().id;
    const sessionId = seedColdSession();
    gate.holdAll();

    const owner = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    await vi.waitFor(() => expect(gate.heldCount()).toBeGreaterThanOrEqual(1));
    await expect(
      runtime.sessionRuntime.restoreSession(otherAgentId, sessionId),
    ).rejects.toBeInstanceOf(NotFoundError);

    gate.releaseAll();
    await expect(owner).resolves.toBe(sessionId);
    expect(gate.buildsFor(sessionId)).toBe(1);
    expect(runtime.sessionRuntime.sessions.get(sessionId)?.getAgentId()).toBe(agentId);
  });

  it("refuses to restore a published runner under a different agent id", async () => {
    const otherAgent = await runtime.projectManager.projectStore.createAgent(
      "other-agent",
      TEST_AGENT_PROFILE,
    );
    const otherAgentId = otherAgent.getProfile().id;
    const sessionId = seedColdSession();
    await runtime.sessionRuntime.restoreSession(agentId, sessionId);

    await expect(
      runtime.sessionRuntime.restoreSession(otherAgentId, sessionId),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(runtime.sessionRuntime.sessionExists(agentId, sessionId)).toBe(true);
    expect(runtime.sessionRuntime.sessionExists(otherAgentId, sessionId)).toBe(false);
    expect(gate.buildsFor(sessionId)).toBe(1);
  });

  it("archiving the session during initialization rejects all joined waiters", async () => {
    const sessionId = seedColdSession();
    gate.holdAll();

    const first = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    const second = runtime.sessionRuntime.restoreSession(agentId, sessionId);
    await vi.waitFor(() => expect(gate.heldCount()).toBeGreaterThanOrEqual(1));
    runtime.projectManager.deleteSession(agentId, sessionId);
    gate.releaseAll();

    await expect(first).rejects.toBeInstanceOf(NotFoundError);
    await expect(second).rejects.toBeInstanceOf(NotFoundError);
    expect(runtime.sessionRuntime.hasActiveSession(sessionId)).toBe(false);
    expect(gate.buildsFor(sessionId)).toBe(1);
  });
});
