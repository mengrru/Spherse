import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSilentLogger } from "../../logger.js";

const connectMcpServerMock = vi.hoisted(() => vi.fn());

vi.mock("../../mcp/mcp-client.js", () => ({
  connectMcpServer: connectMcpServerMock,
}));

import { createProject } from "../../factory.js";
import { AgentRunner } from "../../session/agent-runner.js";
import { deriveMessages } from "../../session/fold.js";
import { RunConfigHolder, type RuntimeDeps } from "../../session/runtime.js";
import { createModelResolver } from "../../session/model-resolver.js";
import { createMcpCapability } from "../../capabilities/mcp/index.js";
import { createStoreRegistry } from "../../kernel/ports.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const TEST_AGENT_PROFILE = `---
name: Retry Agent
tools:
  - read_file
---

Retry agent.`;

function makeTool(name: string): AgentTool {
  return { name, label: name, description: "d", parameters: {} as never, execute: vi.fn() };
}

describe("retry keeps MCP tools after a config change (seam)", () => {
  let tmpDir: string;
  let runtime: Awaited<ReturnType<typeof createProject>>;
  let deps: RuntimeDeps;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-retry-mcp-"));
    runtime = await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    });
    const projectStore = runtime.projectManager.projectStore as never as {
      createAgent: (slug: string, profile: string) => Promise<{ getProfile: () => { id: string } }>;
      updateAgentMcp: (id: string, config: { servers: unknown[] }) => Promise<unknown>;
      getRootPath: () => string;
      getAgent: (id: string) => unknown;
    };
    const testAgent = await projectStore.createAgent("retry-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();

    const runConfig = new RunConfigHolder();
    const stubCatalog = {
      getChatStreamFn: () => vi.fn(),
      resolveModelById: (modelId: string) => {
        const slashIdx = modelId.indexOf("/");
        return slashIdx >= 0
          ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
          : { id: modelId, provider: modelId };
      },
    } as never;
    const mcpCapability = createMcpCapability({ projectStore: projectStore as never, logger: createSilentLogger() });

    deps = {
      projectStore: projectStore as never,
      projectRoot: projectStore.getRootPath(),
      fileWriteMutex: (runtime as never as { sessionRuntime: { deps: { fileWriteMutex: unknown } } }).sessionRuntime.deps.fileWriteMutex,
      logger: createSilentLogger(),
      runConfig,
      modelResolver: createModelResolver(stubCatalog),
      modelCatalog: stubCatalog,
      capabilities: [],
      stores: createStoreRegistry(),
      createTurnHooks: (aid: string, sid: string) => mcpCapability.turnHooks!(aid, sid),
    } as never as RuntimeDeps;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    connectMcpServerMock.mockReset();
  });

  it("retryLastTurn re-merges MCP tools after updateAgentMcp + pending reload", async () => {
    connectMcpServerMock.mockResolvedValue({
      connection: { serverName: "fixture", closed: false, close: vi.fn() },
      tools: [makeTool("mcp__fixture_srv1__echo")],
      info: {
        serverName: "fixture",
        serverId: "srv1",
        capabilities: {},
        resources: [],
        resourceTemplates: [],
        prompts: [{ name: "p1" }],
      },
    });

    const agentStore = (deps.projectStore as never as { getAgent: (id: string) => { sessions: { createSession: () => string }; getProfile: () => unknown } }).getAgent(agentId);
    const sessionId = agentStore.sessions.createSession();
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    const agent = (runner as unknown as { agentRef: { state: { tools: AgentTool[]; systemPrompt: string; messages: unknown[] } } }).agentRef;

    await (deps.projectStore as never as { updateAgentMcp: never }).updateAgentMcp(agentId, {
      servers: [{ id: "srv1", name: "fixture", enabled: true, transport: "stdio", command: "x" }],
    });
    runner.markReloadPending();

    const log = (runner as unknown as { eventLog: { append: (t: never, d: never) => void; events: unknown[] } }).eventLog;
    log.append("user/message" as never, { message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } } as never);
    log.append("assistant/message" as never, { message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "error", timestamp: 2 } } as never);
    agent.state.messages = deriveMessages(log.events as never);
    agent.continue = vi.fn().mockResolvedValue(undefined);
    runConfigOf(deps).update({ defaultModel: "provider/model" });

    await runner.retryLastTurn(() => {});

    expect(agent.state.tools.map((t) => t.name)).toContain("mcp__fixture_srv1__echo");
    expect(agent.state.systemPrompt).toContain('prompt name="p1"');
    expect(agent.continue).toHaveBeenCalledTimes(1);
  });
});

function runConfigOf(deps: RuntimeDeps): { update: (v: unknown) => void } {
  return (deps as unknown as { runConfig: { update: (v: unknown) => void } }).runConfig;
}
