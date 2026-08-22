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
import { deriveMessages } from "../../session/fold.js";
import { RunConfigHolder, type RuntimeDeps } from "../../session/runtime.js";
import { createModelResolver } from "../../session/model-resolver.js";
import { builtinToolCapabilities } from "../../capabilities/builtin.js";
import { createStoreRegistry } from "../../kernel/ports.js";
import { compactionCapability } from "../../capabilities/compaction/index.js";

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

function getAgentStore(runtime: RuntimeInternals, agentId: string): any {
  return runtime.projectManager.projectStore.agents.get(agentId);
}

function runnerOf(runner: AgentRunner): AgentRunner {
  return runner;
}

function agentOf(runner: AgentRunner): any {
  return runner.agentRef;
}

function eventsOf(runner: AgentRunner): any[] {
  return (runner as any).eventLog.events;
}

function seedEvents(runner: AgentRunner, events: Array<{ type: string; data: unknown }>): void {
  const log = (runner as any).eventLog as SessionEventLog;
  for (const e of events) {
    log.append(e.type as never, e.data as never);
  }
  agentOf(runner).state.messages = deriveMessages(log.events);
}

async function compactLive(
  runner: AgentRunner,
  deps: RuntimeDeps,
  agentId: string,
  sessionId: string,
): Promise<void> {
  const hook = (compactionCapability({ logger: createSilentLogger() }).turnHooks ?? (() => ({})))(agentId, sessionId);
  const log = (runner as any).eventLog as SessionEventLog;
  const before = log.events.length;
  await hook.afterTurn!(agentOf(runner), log);
  if (log.events.length !== before) {
    agentOf(runner).state.messages = deriveMessages(log.events);
  }
}

describe("AgentRunner context engineering", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let deps: RuntimeDeps;
  let runConfig: RunConfigHolder;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-live-ctx-"));
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
    runConfig = new RunConfigHolder();
    deps = {
      projectStore,
      projectRoot: projectStore.getRootPath(),
      fileWriteMutex: (runtime as any).sessionRuntime.deps.fileWriteMutex,
      logger: createSilentLogger(),
      runConfig,
      modelResolver: createModelResolver(stubCatalog),
      modelCatalog: stubCatalog,
      capabilities: builtinToolCapabilities(),
      stores: createStoreRegistry(),
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("buildAgent produces XML system prompt with agent-profile", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = { ...agentStore._profile, systemPrompt: "You are a test assistant." };

    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);

    expect(agent.state.systemPrompt).toContain("<agent-profile>");
    expect(agent.state.systemPrompt).toContain("You are a test assistant.");
    expect(agent.state.systemPrompt).not.toContain("## Available Skills");
  });

  it("buildAgent includes project-instructions when AGENTS.md exists", async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# Custom Project\n\nCustom instructions here.",
      "utf-8",
    );

    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);

    expect(agent.state.systemPrompt).toContain("<project-instructions>");
    expect(agent.state.systemPrompt).toContain("Custom Project");
  });

  it("buildAgent includes session-context with name, slug and session id", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const profile = agentStore.getProfile();

    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);

    expect(agent.state.systemPrompt).toContain("<session-context>");
    expect(agent.state.systemPrompt).toContain(`agent-name: ${profile.name}`);
    expect(agent.state.systemPrompt).toContain(`agent-slug: ${profile.slug}`);
    expect(agent.state.systemPrompt).toContain(`session-id: ${sessionId}`);
    expect(agent.state.systemPrompt).not.toContain("agent-alias:");
  });

  it("buildAgent includes agent-alias in session-context when present", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = { ...agentStore._profile, alias: "小明" };
    const profile = agentStore.getProfile();

    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);

    expect(agent.state.systemPrompt).toContain(`agent-name: ${profile.name}`);
    expect(agent.state.systemPrompt).toContain("agent-alias: 小明");
    expect(agent.state.systemPrompt).toContain(`session-id: ${sessionId}`);
  });

  it("does not wire transformContext into the Agent", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);

    expect(agentOf(runner).transformContext).toBeUndefined();
  });

  it("buildAgent merges agent-level skills into skill-catalog with priority over global", async () => {
    const projectStore = runtime.projectManager.projectStore as any;
    const agentStore = getAgentStore(runtime, agentId);

    await projectStore.skill.createSkill(
      "shared-skill",
      "Global description",
      "Global instructions.",
    );
    await projectStore.skill.createSkill(
      "global-only",
      "Global only skill",
      "Only global.",
    );

    const agentSkillsDir = path.join(agentStore.getAgentDir(), "skills");
    await fs.promises.mkdir(path.join(agentSkillsDir, "shared-skill"), { recursive: true });
    await fs.promises.writeFile(
      path.join(agentSkillsDir, "shared-skill", "SKILL.md"),
      "---\nname: shared-skill\ndescription: Agent-local description\n---\n\nAgent-local instructions.",
      "utf-8",
    );
    await fs.promises.mkdir(path.join(agentSkillsDir, "agent-only"), { recursive: true });
    await fs.promises.writeFile(
      path.join(agentSkillsDir, "agent-only", "SKILL.md"),
      "---\nname: agent-only\ndescription: Agent only skill\n---\n\nOnly agent.",
      "utf-8",
    );

    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const prompt = agentOf(runner).state.systemPrompt;

    expect(prompt).toContain("<skill-catalog>");
    expect(prompt).toContain('name="shared-skill"');
    expect(prompt).toContain('description="Agent-local description"');
    expect(prompt).not.toContain('description="Global description"');
    expect(prompt).toContain('name="global-only"');
    expect(prompt).toContain('name="agent-only"');
  });

  it("message log starts empty on create", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);

    expect(eventsOf(runner)).toEqual([]);
  });

  it("restoreSession without restarts restores all message events", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();

    const log = SessionEventLog.open(agentStore.sessions, sessionId);
    log.append("turn/start", {});
    log.append("user/message", { message: { role: "user", content: "hello world", timestamp: Date.now() } as never });
    log.append("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "hi" }], stopReason: "stop", timestamp: Date.now() } as never });
    log.append("turn/end", { reason: "completed" });

    const runner = await AgentRunner.initForRestore(deps, agentId, sessionId);
    const agent = agentOf(runner);
    expect(agent.state.messages.length).toBe(2);
    expect(agent.state.messages[0].role).toBe("user");
    expect(agent.state.messages[0].content).toContain("hello world");
  });

  it("restore synthesizes toolResult for interrupted tool call and persists it", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();

    const log = SessionEventLog.open(agentStore.sessions, sessionId);
    log.append("turn/start", {});
    log.append("user/message", { message: { role: "user", content: "run the tools", timestamp: Date.now() } as never });
    log.append("assistant/message", {
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "calling tools" },
          { type: "toolCall", id: "tc-1", name: "read_file", arguments: { path: "a.md" } },
          { type: "toolCall", id: "tc-2", name: "read_file", arguments: { path: "b.md" } },
        ],
        stopReason: "toolUse",
        timestamp: Date.now(),
      } as never,
    });
    log.append("tool/result", {
      message: {
        role: "toolResult",
        toolCallId: "tc-1",
        toolName: "read_file",
        content: [{ type: "text", text: "content of a" }],
        timestamp: Date.now(),
      } as never,
    });

    const runner = await AgentRunner.initForRestore(deps, agentId, sessionId);
    const messages = agentOf(runner).state.messages;

    const synthesized = messages.find((m: any) => m.role === "toolResult" && m.toolCallId === "tc-2");
    expect(synthesized).toBeDefined();
    expect(synthesized.isError).toBe(true);
    expect(synthesized.content[0].text).toContain("interrupted");

    const persisted = agentStore.sessions.readEvents(sessionId);
    const persistedSynthetic = persisted.filter(
      (e: any) => e.type === "tool/result" && e.data.message.toolCallId === "tc-2",
    );
    expect(persistedSynthetic).toHaveLength(1);

    const restored2 = await AgentRunner.initForRestore(deps, agentId, sessionId);
    const messages2 = agentOf(restored2).state.messages;
    const syntheticCount = messages2.filter((m: any) => m.role === "toolResult" && m.toolCallId === "tc-2").length;
    expect(syntheticCount).toBe(1);
  });

  it("restore leaves fully answered tool calls untouched", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();

    const log = SessionEventLog.open(agentStore.sessions, sessionId);
    log.append("turn/start", {});
    log.append("user/message", { message: { role: "user", content: "run the tool", timestamp: Date.now() } as never });
    log.append("assistant/message", {
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tc-1", name: "read_file", arguments: { path: "a.md" } },
        ],
        stopReason: "toolUse",
        timestamp: Date.now(),
      } as never,
    });
    log.append("tool/result", {
      message: {
        role: "toolResult",
        toolCallId: "tc-1",
        toolName: "read_file",
        content: [{ type: "text", text: "content of a" }],
        timestamp: Date.now(),
      } as never,
    });
    log.append("turn/end", { reason: "completed" });

    const runner = await AgentRunner.initForRestore(deps, agentId, sessionId);
    expect(agentOf(runner).state.messages.length).toBe(3);
    expect(agentStore.sessions.readEvents(sessionId).length).toBe(5);
  });

  it("restoreSession with compaction restart restores digest + tail", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();

    const log = SessionEventLog.open(agentStore.sessions, sessionId);
    log.append("user/message", { message: { role: "user", content: "early q", timestamp: Date.now() } as never });
    log.append("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "early a" }], stopReason: "stop", timestamp: Date.now() } as never });
    log.append("compaction/applied", {
      anchorSeq: 1,
      digestContent: "[user]: early q",
      excludedSeqs: [],
    });
    log.append("user/message", { message: { role: "user", content: "tail question", timestamp: Date.now() } as never });
    log.append("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "tail answer" }], stopReason: "stop", timestamp: Date.now() } as never });

    const runner = await AgentRunner.initForRestore(deps, agentId, sessionId);
    const agent = agentOf(runner);
    expect(agent.state.messages.length).toBe(3);
    expect(agent.state.messages[0].role).toBe("user");
    expect(agent.state.messages[0].content).toContain("<compaction-digest");
    expect(agent.state.messages[0].content).toContain("early q");
    expect(agent.state.messages[1].role).toBe("user");
    expect(agent.state.messages[1].content).toContain("tail question");
    expect(agent.state.messages[2].role).toBe("assistant");
  });

  it("maybeCompact appends compaction/applied with real anchorSeq", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);

    const seeded: Array<{ type: string; data: unknown }> = [];
    for (let i = 0; i < 25; i++) {
      seeded.push({
        type: "user/message",
        data: { message: { role: "user", content: `turn ${i} with some text`, timestamp: Date.now() + i } },
      });
      seeded.push({
        type: "assistant/message",
        data: { message: { role: "assistant", content: [{ type: "text", text: `reply ${i} with some text` }], stopReason: "stop", timestamp: Date.now() + i } },
      });
    }
    seedEvents(runner, seeded);
    agent.state.model.contextWindow = 10;

    await compactLive(runner, deps, agentId, sessionId);

    const compactionEvents = eventsOf(runner).filter((e: any) => e.type === "compaction/applied");
    expect(compactionEvents).toHaveLength(1);
    expect(compactionEvents[0].data.anchorSeq).toBeGreaterThan(0);
    expect(agent.state.messages.length).toBeLessThan(50);
  });

  it("repeated compaction is idempotent and does not over-include messages on restore", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);

    const seeded: Array<{ type: string; data: unknown }> = [];
    for (let i = 0; i < 25; i++) {
      seeded.push({
        type: "user/message",
        data: { message: { role: "user", content: `turn ${i} text`, timestamp: Date.now() + i } },
      });
      seeded.push({
        type: "assistant/message",
        data: { message: { role: "assistant", content: [{ type: "text", text: `reply ${i} text` }], stopReason: "stop", timestamp: Date.now() + i } },
      });
    }
    seedEvents(runner, seeded);
    agent.state.model.contextWindow = 10;

    await compactLive(runner, deps, agentId, sessionId);
    await compactLive(runner, deps, agentId, sessionId);

    const totalEvents = agentStore.sessions.readEvents(sessionId).length;
    expect(totalEvents).toBe(51);
    expect(eventsOf(runner).filter((event) => event.type === "compaction/applied")).toHaveLength(1);

    const restored = await AgentRunner.initForRestore(deps, agentId, sessionId);
    const restoredAgent = agentOf(restored);
    expect(restoredAgent.state.messages.length).toBeLessThan(50);
  });

  it("applyReload rebuilds system prompt and tools from fresh profile", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = { ...agentStore._profile, systemPrompt: "Original system prompt body." };
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);
    expect(agent.state.systemPrompt).toContain("Original system prompt body.");
    expect(agent.state.tools.length).toBeGreaterThan(0);

    agentStore._profile = { ...agentStore._profile, systemPrompt: "Reloaded system prompt body.", tools: [] };

    await runnerOf(runner).applyReload();

    expect(agent.state.systemPrompt).toContain("Reloaded system prompt body.");
    expect(agent.state.systemPrompt).not.toContain("Original system prompt body.");
    expect(agent.state.tools).toEqual([]);
  });

  it("retryLastTurn also consumes a pending reload before continuing (M5)", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    runConfig.update({ defaultModel: "provider/model" });
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const onReload = vi.fn();
    deps.createTurnHooks = () => ({ onReload });
    runner.markReloadPending();

    seedEvents(runner, [
      { type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } } },
      { type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "error", timestamp: 2 } } },
    ]);
    agentOf(runner).continue = vi.fn().mockResolvedValue(undefined);

    await runner.retryLastTurn(() => {});

    expect(agentOf(runner).continue).toHaveBeenCalledTimes(1);
  });

  it("markReloadPending defers reload until the next sendMessage", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = { ...agentStore._profile, systemPrompt: "Original prompt." };
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);
    const originalPrompt = agent.state.systemPrompt;

    agentStore._profile = { ...agentStore._profile, systemPrompt: "New prompt not yet applied." };
    runner.markReloadPending();

    expect(runnerOf(runner).pendingReload).toBe(true);
    expect(agent.state.systemPrompt).toBe(originalPrompt);
  });

  it("applyReload keeps previous config when reload fails", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);
    const originalPrompt = agent.state.systemPrompt;

    (agentStore as any)._profile = null;

    await expect(runnerOf(runner).applyReload()).resolves.toBeUndefined();
    expect(agent.state.systemPrompt).toBe(originalPrompt);
  });

  it("applyReload is a no-op when the agent store no longer exists", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);
    const originalPrompt = agent.state.systemPrompt;

    (deps.projectStore as any)._agents.delete(agentId);

    await expect(runnerOf(runner).applyReload()).resolves.toBeUndefined();
    expect(agent.state.systemPrompt).toBe(originalPrompt);
  });

  it("applyReload notifies turn hooks to reset memoized state", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const onReload = vi.fn();
    deps.createTurnHooks = () => ({ onReload });
    const runner = await AgentRunner.init(deps, agentId, sessionId);

    await runnerOf(runner).applyReload();

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("retryLastTurn abandons the failed assistant message event (non-destructive)", async () => {
    runConfig.update({ defaultModel: "provider/model" });
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = agentOf(runner);

    seedEvents(runner, [
      { type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } } },
      { type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "error", errorMessage: "boom", timestamp: 2 } } },
    ]);

    agent.continue = vi.fn().mockResolvedValue(undefined);

    await runner.retryLastTurn(() => {});

    expect(agent.continue).toHaveBeenCalledTimes(1);
    expect(agent.state.messages.length).toBe(1);
    expect(agent.state.messages[0].role).toBe("user");

    const retriedEvents = eventsOf(runner).filter((e: any) => e.type === "turn/retried");
    expect(retriedEvents).toHaveLength(1);
    expect(retriedEvents[0].data.abandonedSeqs).toHaveLength(1);
    expect(agentStore.sessions.readEvents(sessionId)).toHaveLength(4);
  });

  it("retryLastTurn rejects when the last event is not a failed assistant message", async () => {
    runConfig.update({ defaultModel: "provider/model" });
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    seedEvents(runner, [
      { type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } } },
      { type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop", timestamp: 2 } } },
    ]);

    await expect(runner.retryLastTurn(() => {})).rejects.toThrow(/no failed assistant turn/);
  });
});

describe("AgentRunner yolo mode", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let deps: RuntimeDeps;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-yolo-"));
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
      runConfig: new RunConfigHolder(),
      modelResolver: createModelResolver(stubCatalog),
      modelCatalog: stubCatalog,
      capabilities: builtinToolCapabilities(),
      stores: createStoreRegistry(),
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function findTool(runner: AgentRunner, name: string): any {
    return agentOf(runner).state.tools.find((t: any) => t.name === name);
  }

  it("yolo agent runs run_command without approval", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = {
      ...agentStore._profile,
      tools: ["run_command"],
      yolo: true,
    };
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);

    const runCommand = findTool(runner, "run_command");
    expect(runCommand).toBeDefined();

    const result = await runCommand.execute("call-1", { command: "echo yolo-bypass" });
    const text = result.content.map((c: any) => c.text).join("");
    expect(text).toContain("yolo-bypass");
    expect(result.details.status).toBe("completed");
    expect(result.details.exitCode).toBe(0);
  });

  it("non-yolo agent requires approval before run_command executes", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = {
      ...agentStore._profile,
      tools: ["run_command"],
      yolo: false,
    };
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);

    const runCommand = findTool(runner, "run_command");
    expect(runCommand).toBeDefined();

    const PENDING = Symbol("pending");
    const settled = await Promise.race([
      runCommand.execute("call-2", { command: "echo should-not-run" }).then(
        () => "completed" as const,
        () => "rejected" as const,
      ),
      new Promise<typeof PENDING>((resolve) =>
        setTimeout(() => resolve(PENDING), 400),
      ),
    ]);

    expect(settled).toBe(PENDING);
  });

  it("ask_user routes through the control bus and resolves with the user's answer", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = {
      ...agentStore._profile,
      tools: ["ask_user"],
    };
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);

    const askUser = findTool(runner, "ask_user");
    expect(askUser).toBeDefined();

    const controlBus = runnerOf(runner).controlBus;
    controlBus.setEventSink((e: any) => {
      if (e.type === "control_request" && e.kind === "question") {
        expect(e.toolName).toBe("ask_user");
        queueMicrotask(() =>
          runner.resolveControlRequest(e.requestId, { answer: "wired-answer", timedOut: false }),
        );
      }
    });

    try {
      const result = await askUser.execute("call-ask-1", { question: "What next?" });
      const text = result.content.map((c: any) => c.text).join("");
      expect(text).toContain("User's answer:");
      expect(text).toContain("wired-answer");
      expect(result.details.cardType).toBe("question");
      expect(result.details.answer).toBe("wired-answer");
    } finally {
      controlBus.setEventSink(null);
    }
  });

  it("applyReload picks up yolo change on next turn", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = {
      ...agentStore._profile,
      tools: ["run_command"],
      yolo: false,
    };
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);

    agentStore._profile = { ...agentStore._profile, yolo: true };
    await runnerOf(runner).applyReload();

    const runCommand = findTool(runner, "run_command");
    const result = await runCommand.execute("call-3", { command: "echo yolo-reloaded" });
    const text = result.content.map((c: any) => c.text).join("");
    expect(text).toContain("yolo-reloaded");
    expect(result.details.status).toBe("completed");
  });
});
