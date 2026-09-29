import { describe, expect, it, vi } from "vitest";
import { createMcpCapability } from "../../capabilities/mcp/index.js";
import type { ProjectStore } from "../../store/project.js";
import type { Logger } from "../../logger.js";
import { createSilentLogger } from "../../logger.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { McpServerConfig, McpServerInfo } from "../../mcp/types.js";

vi.mock("../../mcp/mcp-client.js", () => ({
  connectMcpServer: vi.fn(),
}));

const { connectMcpServer } = await import("../../mcp/mcp-client.js");
const connectMock = vi.mocked(connectMcpServer);

function makeTool(name: string): AgentTool {
  return { name, label: name, description: "d", parameters: {} as never, execute: vi.fn() };
}

function makeConnection() {
  const state = { closed: false };
  return {
    serverName: "fixture",
    get closed() {
      return state.closed;
    },
    close: vi.fn(async () => {
      state.closed = true;
    }),
  };
}

function okConnect(tools: AgentTool[], info: Partial<McpServerInfo> = {}) {
  return {
    connection: makeConnection(),
    tools,
    info: {
      serverName: "fixture",
      serverId: "srv1",
      resources: info.resources ?? [],
      resourceTemplates: [],
      prompts: info.prompts ?? [],
      ...info,
    } as McpServerInfo,
  };
}

function fakeStore(configs: McpServerConfig[]): ProjectStore {
  return {
    getAgent: () => ({ mcp: { getConfig: async () => ({ servers: configs }) } }),
  } as unknown as ProjectStore;
}

const STDIO: McpServerConfig = {
  id: "srv1",
  name: "fixture",
  enabled: true,
  transport: "stdio",
  command: "x",
};

async function initCapability(configs: McpServerConfig[]) {
  const logger: Logger = createSilentLogger();
  const capability = createMcpCapability({ projectStore: fakeStore(configs), logger });
  await capability.init({
    projectRoot: "/tmp",
    metaDir: "/tmp/.spherse",
    logger,
    fileWriteMutex: { run: (_p, fn) => fn() } as never,
    stores: { register: () => {}, get: () => undefined, forAgent: () => ({ get: () => undefined, set: (_n, v) => v, delete: () => {}, clear: () => {} }), clearAgent: () => {} },
    session: { createSession: async () => "s", restoreSession: async () => "s", sendMessage: async () => {}, sessionExists: () => false },
  });
  return capability;
}

function makeAgent() {
  return {
    state: {
      tools: [{ name: "builtin_tool", label: "b", description: "d", parameters: {} as never, execute: vi.fn() }],
      systemPrompt: "BASE PROMPT",
      model: undefined,
    },
  } as never;
}

describe("mcp capability beforeTurn self-healing merge", () => {
  it("merges mcp tools and wraps the context block in sentinels", async () => {
    connectMock.mockResolvedValueOnce(okConnect([makeTool("mcp__fixture_srv1__echo")], { prompts: [{ name: "p" }] }));
    const capability = await initCapability([STDIO]);
    const hooks = capability.turnHooks!("agent-1", "session-1");
    const agent = makeAgent();

    await hooks.beforeTurn!(agent);

    const state = (agent as { state: { tools: AgentTool[]; systemPrompt: string } }).state;
    expect(state.tools.map((t) => t.name)).toEqual(["builtin_tool", "mcp__fixture_srv1__echo"]);
    expect(state.systemPrompt.startsWith("BASE PROMPT")).toBe(true);
    expect(state.systemPrompt).toContain("<!-- spherse:mcp-context:start -->");
    expect(state.systemPrompt).toContain("<!-- spherse:mcp-context:end -->");
  });

  it("re-merge strips previously merged mcp tools (including dedupe suffixes) and the old block", async () => {
    connectMock.mockResolvedValueOnce(
      okConnect([makeTool("mcp__fixture_srv1__a"), makeTool("mcp__fixture_srv1__b")], {
        prompts: [{ name: "p1" }],
      }),
    );
    const capability = await initCapability([STDIO]);
    const hooks = capability.turnHooks!("agent-1", "session-1");
    const agent = makeAgent();

    await hooks.beforeTurn!(agent);
    const state = (agent as { state: { tools: AgentTool[]; systemPrompt: string } }).state;
    state.tools.push({ ...makeTool("mcp__fixture_srv1__b__2") });
    const promptAfterFirst = state.systemPrompt;
    expect(promptAfterFirst).toContain('prompt name="p1"');

    connectMock.mockResolvedValueOnce(okConnect([makeTool("mcp__fixture_srv1__c")], { prompts: [{ name: "p2" }] }));
    await capability.onAgentConfigChanged!("agent-1", "mcp");
    await hooks.beforeTurn!(agent);

    expect(state.tools.map((t) => t.name)).toEqual(["builtin_tool", "mcp__fixture_srv1__c"]);
    expect(state.systemPrompt).not.toBe(promptAfterFirst);
    expect(state.systemPrompt).not.toContain('prompt name="p1"');
    expect(state.systemPrompt).toContain('prompt name="p2"');
    expect((state.systemPrompt.match(/<!-- spherse:mcp-context:start -->/g) ?? []).length).toBe(1);
  });

  it("removing all servers drops every mcp tool and the context block", async () => {
    connectMock.mockResolvedValueOnce(okConnect([makeTool("mcp__fixture_srv1__a")]));
    const capability = await initCapability([STDIO]);
    const hooks = capability.turnHooks!("agent-1", "session-1");
    const agent = makeAgent();
    await hooks.beforeTurn!(agent);

    const state = (agent as { state: { tools: AgentTool[]; systemPrompt: string } }).state;
    expect(state.tools).toHaveLength(2);

    connectMock.mockResolvedValueOnce(okConnect([]));
    await capability.onAgentConfigChanged!("agent-1", "mcp");
    await hooks.beforeTurn!(agent);

    expect(state.tools.map((t) => t.name)).toEqual(["builtin_tool"]);
    expect(state.systemPrompt).toBe("BASE PROMPT");
  });

  it("onReload resets the memo so the next turn re-merges", async () => {
    connectMock.mockResolvedValue(okConnect([makeTool("mcp__fixture_srv1__a")]));
    const capability = await initCapability([STDIO]);
    const hooks = capability.turnHooks!("agent-1", "session-1");
    const agent = makeAgent();

    await hooks.beforeTurn!(agent);
    hooks.onReload?.();
    await hooks.beforeTurn!(agent);

    const state = (agent as { state: { tools: AgentTool[] } }).state;
    expect(state.tools.map((t) => t.name)).toEqual(["builtin_tool", "mcp__fixture_srv1__a"]);
  });
});
