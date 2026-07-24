import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  McpConnectionManager,
  type McpConnectFn,
  type McpLoadServersFn,
} from "../../mcp/mcp-connection-manager.js";
import type { McpServerConfig } from "../../mcp/types.js";

const ENABLED: McpServerConfig = { id: "s1", name: "fs", enabled: true, transport: "stdio", command: "npx" };
const DISABLED: McpServerConfig = { id: "s2", name: "off", enabled: false, transport: "stdio", command: "x" };

function makeTool(name: string): AgentTool {
  return { name, label: name, description: "d", parameters: {} as never, execute: vi.fn() };
}

describe("McpConnectionManager (per-agent tool cache)", () => {
  let connect: ReturnType<typeof vi.fn<McpConnectFn>>;
  let loadServers: ReturnType<typeof vi.fn<McpLoadServersFn>>;
  let manager: McpConnectionManager;

  beforeEach(() => {
    connect = vi.fn<McpConnectFn>();
    loadServers = vi.fn<McpLoadServersFn>();
    manager = new McpConnectionManager(undefined, connect, loadServers);
  });

  it("connects once and caches the tool list across getTools calls", async () => {
    const tools = [makeTool("mcp__fs__read")];
    loadServers.mockResolvedValue([ENABLED]);
    connect.mockResolvedValue({ tools, connections: [] });

    const first = await manager.getTools("agent-1");
    const second = await manager.getTools("agent-1");

    expect(first).toBe(tools);
    expect(second).toBe(tools);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(loadServers).toHaveBeenCalledTimes(1);
  });

  it("caches per agent, connecting once per agent", async () => {
    loadServers.mockResolvedValue([ENABLED]);
    connect.mockResolvedValueOnce({ tools: [makeTool("a")], connections: [] });
    connect.mockResolvedValueOnce({ tools: [makeTool("b")], connections: [] });

    await manager.getTools("agent-a");
    await manager.getTools("agent-b");
    await manager.getTools("agent-a");

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent getTools via inflight promise", async () => {
    const tools = [makeTool("t")];
    loadServers.mockResolvedValue([ENABLED]);
    let resolveConnect: ((v: { tools: AgentTool[]; connections: never[] }) => void) | undefined;
    connect.mockImplementation(
      () =>
        new Promise((r) => {
          resolveConnect = r;
        }) as Promise<{ tools: AgentTool[]; connections: never[] }>,
    );

    const p1 = manager.getTools("agent-1");
    await new Promise((r) => setTimeout(r, 0));
    const p2 = manager.getTools("agent-1");
    resolveConnect!({ tools, connections: [] });

    expect(await p1).toBe(tools);
    expect(await p2).toBe(tools);
    expect(loadServers).toHaveBeenCalledTimes(1);
  });

  it("only connects enabled servers", async () => {
    loadServers.mockResolvedValue([ENABLED, DISABLED]);
    connect.mockResolvedValue({ tools: [makeTool("t")], connections: [] });

    await manager.getTools("agent-1");

    expect(connect).toHaveBeenCalledWith([ENABLED], expect.anything());
    expect(connect).not.toHaveBeenCalledWith(
      expect.arrayContaining([DISABLED]),
      expect.anything(),
    );
  });

  it("invalidate closes the agent connections and forces reconnect", async () => {
    const connection = { serverName: "fs", close: vi.fn().mockResolvedValue(undefined) };
    loadServers.mockResolvedValue([ENABLED]);
    connect.mockResolvedValueOnce({ tools: [makeTool("v1")], connections: [connection] });
    connect.mockResolvedValueOnce({ tools: [makeTool("v2")], connections: [] });

    await manager.getTools("agent-1");
    await manager.invalidate("agent-1");
    expect(connection.close).toHaveBeenCalledTimes(1);

    const after = await manager.getTools("agent-1");
    expect(after).toHaveLength(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("closeAll closes every agent's connections and clears the cache", async () => {
    const connA = { serverName: "a", close: vi.fn().mockResolvedValue(undefined) };
    const connB = { serverName: "b", close: vi.fn().mockResolvedValue(undefined) };
    loadServers.mockResolvedValue([ENABLED]);
    connect.mockResolvedValueOnce({ tools: [makeTool("a")], connections: [connA] });
    connect.mockResolvedValueOnce({ tools: [makeTool("b")], connections: [connB] });
    await manager.getTools("agent-a");
    await manager.getTools("agent-b");

    await manager.closeAll();
    expect(connA.close).toHaveBeenCalledTimes(1);
    expect(connB.close).toHaveBeenCalledTimes(1);

    connect.mockResolvedValueOnce({ tools: [makeTool("c")], connections: [] });
    await manager.getTools("agent-a");
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it("returns empty tools (no throw) when connect fails, allowing retry", async () => {
    loadServers.mockResolvedValue([ENABLED]);
    connect.mockRejectedValueOnce(new Error("boom"));
    const first = await manager.getTools("agent-1");
    expect(first).toEqual([]);

    connect.mockResolvedValueOnce({ tools: [makeTool("ok")], connections: [] });
    const second = await manager.getTools("agent-1");
    expect(second).toHaveLength(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
