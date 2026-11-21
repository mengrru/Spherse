import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@spherse/core";
import { agentMethods } from "../rpc/methods/agents.js";
import { createFakeProjectCtx, createRpcHarness, flush } from "./rpc-test-utils.js";

const PROFILE = {
  id: "agent-1",
  name: "Helper",
  alias: "Hal",
  slug: "helper",
  createdAt: 1234,
  memory: { enabled: true },
  systemPrompt: "You help.",
  filePath: "agents/helper.md",
};

const UPDATED_PROFILE = { ...PROFILE, name: "Helper v2" };

const RAW = "---\nname: Helper\n---\nbody";

const THEME = ".agent{color:red}";

const MCP = {
  servers: [
    {
      id: "fs",
      name: "fs",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "server"],
    },
    { id: "remote", name: "remote", enabled: false, transport: "http", url: "https://mcp.test/s" },
  ],
};

const MEMORY = { enabled: true, core: "core text", coreLimit: 4000 };

const ENTRY = { id: "e1", content: "fact", tags: ["alpha"], createdAt: 1, updatedAt: 2 };

interface ResultFrame {
  type: string;
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: number; message: string };
}

function singleFrame(frames: unknown[]): ResultFrame {
  expect(frames).toHaveLength(1);
  return frames[0] as ResultFrame;
}

function createAgentsHarness() {
  const pm = {
    listAgents: vi.fn(() => [PROFILE]),
    getAgentProfile: vi.fn((_id: string) => PROFILE),
    getRawContent: vi.fn(() => RAW),
    getAgentTheme: vi.fn(() => THEME),
    createAgent: vi.fn(() => Promise.resolve(PROFILE)),
    getAgentMcp: vi.fn(() => MCP),
  };
  const rt = {
    updateAgent: vi.fn(() => Promise.resolve(UPDATED_PROFILE)),
    deleteAgent: vi.fn(() => Promise.resolve()),
    updateAgentMcp: vi.fn(() => Promise.resolve(MCP)),
    getAgentMemory: vi.fn(() => Promise.resolve(MEMORY)),
    updateAgentMemory: vi.fn(() => Promise.resolve(MEMORY)),
    listAgentMemoryEntries: vi.fn(() => [ENTRY]),
    updateAgentMemoryEntry: vi.fn(() => ENTRY),
    deleteAgentMemoryEntry: vi.fn(),
  };
  const harness = createRpcHarness({
    methods: agentMethods,
    projectCtx: createFakeProjectCtx({
      projectManager: pm as never,
      runtime: rt as never,
    }),
  });
  return { ...harness, pm, rt };
}

async function call(
  method: string,
  params: unknown,
): Promise<{ frame: ResultFrame; h: ReturnType<typeof createAgentsHarness> }> {
  const h = createAgentsHarness();
  h.receive({ type: "call", id: 1, method, params });
  await flush();
  return { frame: singleFrame(h.sent()), h };
}

describe("rpc agents methods", () => {
  it("agents.list maps profiles to summaries", async () => {
    const { frame, h } = await call("agents.list", { projectId: "p1" });
    expect(h.pm.listAgents).toHaveBeenCalledWith();
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual([
      {
        id: "agent-1",
        name: "Helper",
        alias: "Hal",
        slug: "helper",
        createdAt: 1234,
        memoryEnabled: true,
      },
    ]);
  });

  it("agents.get returns the agent profile", async () => {
    const { frame, h } = await call("agents.get", { projectId: "p1", id: "agent-1" });
    expect(h.pm.getAgentProfile).toHaveBeenCalledWith("agent-1");
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual(PROFILE);
  });

  it("agents.getRaw returns raw content", async () => {
    const { frame, h } = await call("agents.getRaw", { projectId: "p1", id: "agent-1" });
    expect(h.pm.getRawContent).toHaveBeenCalledWith("agent-1");
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual({ content: RAW });
  });

  it("agents.getTheme returns css text", async () => {
    const { frame, h } = await call("agents.getTheme", { projectId: "p1", id: "agent-1" });
    expect(h.pm.getAgentTheme).toHaveBeenCalledWith("agent-1");
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toBe(THEME);
  });

  it("agents.create delegates to projectManager.createAgent", async () => {
    const { frame, h } = await call("agents.create", {
      projectId: "p1",
      slugBase: "helper",
      content: "---\nname: Helper\n---\nbody",
    });
    expect(h.pm.createAgent).toHaveBeenCalledWith("helper", "---\nname: Helper\n---\nbody", undefined);
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual({ ok: true, id: "agent-1" });
  });

  it("agents.create forwards themeContent", async () => {
    const { frame, h } = await call("agents.create", {
      projectId: "p1",
      slugBase: "helper",
      content: "body",
      themeContent: THEME,
    });
    expect(h.pm.createAgent).toHaveBeenCalledWith("helper", "body", THEME);
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual({ ok: true, id: "agent-1" });
  });

  it("agents.update delegates to runtime.updateAgent", async () => {
    const { frame, h } = await call("agents.update", {
      projectId: "p1",
      id: "agent-1",
      content: "new body",
      themeContent: THEME,
    });
    expect(h.rt.updateAgent).toHaveBeenCalledWith("agent-1", "new body", THEME);
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual({ ok: true, id: "agent-1" });
  });

  it("agents.delete delegates to runtime.deleteAgent", async () => {
    const { frame, h } = await call("agents.delete", { projectId: "p1", id: "agent-1" });
    expect(h.rt.deleteAgent).toHaveBeenCalledWith("agent-1");
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual({ ok: true });
  });

  it("agents.getMcp returns the mcp config", async () => {
    const { frame, h } = await call("agents.getMcp", { projectId: "p1", id: "agent-1" });
    expect(h.pm.getAgentMcp).toHaveBeenCalledWith("agent-1");
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual(MCP);
  });

  it("agents.updateMcp delegates to runtime.updateAgentMcp", async () => {
    const { frame, h } = await call("agents.updateMcp", {
      projectId: "p1",
      id: "agent-1",
      servers: MCP.servers,
    });
    expect(h.rt.updateAgentMcp).toHaveBeenCalledWith("agent-1", { servers: MCP.servers });
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual(MCP);
  });

  it("agents.getMemoryConfig returns memory settings", async () => {
    const { frame, h } = await call("agents.getMemoryConfig", { projectId: "p1", id: "agent-1" });
    expect(h.rt.getAgentMemory).toHaveBeenCalledWith("agent-1");
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual(MEMORY);
  });

  it("agents.updateMemoryConfig applies enabled and core", async () => {
    const { frame, h } = await call("agents.updateMemoryConfig", {
      projectId: "p1",
      id: "agent-1",
      enabled: false,
      core: "new core",
    });
    expect(h.rt.updateAgentMemory).toHaveBeenCalledWith("agent-1", {
      enabled: false,
      core: "new core",
    });
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual(MEMORY);
  });

  it("agents.listMemoryEntries filters by query", async () => {
    const { frame, h } = await call("agents.listMemoryEntries", {
      projectId: "p1",
      id: "agent-1",
      q: "fact",
    });
    expect(h.rt.listAgentMemoryEntries).toHaveBeenCalledWith("agent-1", "fact");
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual({ entries: [ENTRY] });
  });

  it("agents.listMemoryEntries omits the query when absent", async () => {
    const { h } = await call("agents.listMemoryEntries", { projectId: "p1", id: "agent-1" });
    expect(h.rt.listAgentMemoryEntries).toHaveBeenCalledWith("agent-1", undefined);
  });

  it("agents.updateMemoryEntry applies the patch", async () => {
    const { frame, h } = await call("agents.updateMemoryEntry", {
      projectId: "p1",
      id: "agent-1",
      entryId: "e1",
      content: "updated",
      tags: ["beta"],
    });
    expect(h.rt.updateAgentMemoryEntry).toHaveBeenCalledWith("agent-1", "e1", {
      content: "updated",
      tags: ["beta"],
    });
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual(ENTRY);
  });

  it("agents.deleteMemoryEntry removes the entry", async () => {
    const { frame, h } = await call("agents.deleteMemoryEntry", {
      projectId: "p1",
      id: "agent-1",
      entryId: "e1",
    });
    expect(h.rt.deleteAgentMemoryEntry).toHaveBeenCalledWith("agent-1", "e1");
    expect(frame).toMatchObject({ type: "result", id: 1, ok: true });
    expect(frame.data).toEqual({ ok: true });
  });
});

describe("rpc agents error mapping", () => {
  it("maps unknown project to code 100", async () => {
    const { frame } = await call("agents.list", { projectId: "missing" });
    expect(frame).toMatchObject({
      type: "result",
      id: 1,
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });

  it("maps missing agent profile to code 100", async () => {
    const h = createAgentsHarness();
    h.pm.getAgentProfile.mockReturnValue(null);
    h.receive({ type: "call", id: 2, method: "agents.get", params: { projectId: "p1", id: "nope" } });
    await flush();
    expect(singleFrame(h.sent())).toMatchObject({
      ok: false,
      error: { code: 100, message: "Agent not found" },
    });
  });

  it("maps missing raw content to code 100", async () => {
    const h = createAgentsHarness();
    h.pm.getRawContent.mockResolvedValue(null);
    h.receive({ type: "call", id: 3, method: "agents.getRaw", params: { projectId: "p1", id: "nope" } });
    await flush();
    expect(singleFrame(h.sent())).toMatchObject({
      ok: false,
      error: { code: 100, message: "Agent not found" },
    });
  });

  it("rejects empty create payload with -32602", async () => {
    const { frame } = await call("agents.create", {
      projectId: "p1",
      slugBase: "",
      content: "body",
    });
    expect(frame).toMatchObject({ ok: false, error: { code: -32602 } });
  });

  it("rejects empty update content with -32602", async () => {
    const { frame } = await call("agents.update", { projectId: "p1", id: "agent-1", content: "" });
    expect(frame).toMatchObject({ ok: false, error: { code: -32602 } });
  });

  it("rejects wrong-typed params with -32602", async () => {
    const { frame } = await call("agents.deleteMemoryEntry", {
      projectId: "p1",
      id: "agent-1",
      entryId: 7,
    });
    expect(frame).toMatchObject({ ok: false, error: { code: -32602 } });
  });

  it("maps ConflictError from handlers to code 102", async () => {
    const h = createAgentsHarness();
    h.pm.createAgent.mockRejectedValue(new ConflictError("agent slug already exists"));
    h.receive({
      type: "call",
      id: 4,
      method: "agents.create",
      params: { projectId: "p1", slugBase: "helper", content: "body" },
    });
    await flush();
    expect(singleFrame(h.sent())).toMatchObject({
      ok: false,
      error: { code: 102, message: "agent slug already exists" },
    });
  });

  it("maps core NotFoundError to code 100", async () => {
    const h = createAgentsHarness();
    h.pm.getAgentMcp.mockImplementation(() => {
      throw new NotFoundError('Agent "nope" not found');
    });
    h.receive({ type: "call", id: 5, method: "agents.getMcp", params: { projectId: "p1", id: "nope" } });
    await flush();
    expect(singleFrame(h.sent())).toMatchObject({
      ok: false,
      error: { code: 100, message: 'Agent "nope" not found' },
    });
  });

  it("maps ValidationError from memory writes to -32602", async () => {
    const h = createAgentsHarness();
    h.rt.updateAgentMemory.mockRejectedValue(new ValidationError("core memory exceeds 4000 characters"));
    h.receive({
      type: "call",
      id: 6,
      method: "agents.updateMemoryConfig",
      params: { projectId: "p1", id: "agent-1", core: "x".repeat(4001) },
    });
    await flush();
    expect(singleFrame(h.sent())).toMatchObject({
      ok: false,
      error: { code: -32602, message: "core memory exceeds 4000 characters" },
    });
  });
});
