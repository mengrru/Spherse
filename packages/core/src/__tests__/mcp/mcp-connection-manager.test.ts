import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  McpConnectionManager,
  type McpConnectFn,
  type McpLoadServersFn,
} from "../../mcp/mcp-connection-manager.js";
import type { ConnectServerOptions } from "../../mcp/mcp-client.js";
import type { McpServerConfig, McpServerInfo } from "../../mcp/types.js";

const ENABLED: McpServerConfig = { id: "s1", name: "fs", enabled: true, transport: "stdio", command: "npx" };
const OTHER: McpServerConfig = { id: "s3", name: "web", enabled: true, transport: "stdio", command: "y" };
const DISABLED: McpServerConfig = { id: "s2", name: "off", enabled: false, transport: "stdio", command: "x" };

function makeTool(name: string): AgentTool {
  return { name, label: name, description: "d", parameters: {} as never, execute: vi.fn() };
}

function makeInfo(name: string): McpServerInfo {
  return {
    serverName: name,
    serverId: "s1",
    resources: [],
    resourceTemplates: [],
    prompts: [],
  };
}

function makeConnection(name: string) {
  const state = { closed: false, closeCalls: 0 };
  return {
    serverName: name,
    get closed() {
      return state.closed;
    },
    close: vi.fn(async () => {
      state.closed = true;
      state.closeCalls += 1;
    }),
    simulateDisconnect() {
      state.closed = true;
    },
  };
}

type ConnectResultTuple = { tools: AgentTool[]; connection: ReturnType<typeof makeConnection>; info: McpServerInfo };

function okResult(name: string, toolName: string): ConnectResultTuple {
  return { tools: [makeTool(toolName)], connection: makeConnection(name), info: makeInfo(name) };
}

describe("McpConnectionManager (per-server cache + lifecycle)", () => {
  let connect: ReturnType<typeof vi.fn<McpConnectFn>>;
  let loadServers: ReturnType<typeof vi.fn<McpLoadServersFn>>;
  let manager: McpConnectionManager;

  beforeEach(() => {
    connect = vi.fn<McpConnectFn>();
    loadServers = vi.fn<McpLoadServersFn>();
    manager = new McpConnectionManager(undefined, connect, loadServers);
  });

  it("connects once per server and caches the tool list across load calls", async () => {
    loadServers.mockResolvedValue([ENABLED]);
    connect.mockResolvedValue(okResult("fs", "mcp__fs__read"));

    const first = await manager.load("agent-1");
    const second = await manager.load("agent-1");

    expect(first.tools.map((t) => t.name)).toEqual(["mcp__fs__read"]);
    expect(first.info).toHaveLength(1);
    expect(second.tools).toEqual(first.tools);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("caches per agent, connecting once per agent", async () => {
    loadServers.mockResolvedValue([ENABLED]);
    connect.mockResolvedValueOnce(okResult("a", "t-a"));
    connect.mockResolvedValueOnce(okResult("b", "t-b"));

    await manager.load("agent-a");
    await manager.load("agent-b");
    await manager.load("agent-a");

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent load passes via the inflight promise", async () => {
    loadServers.mockResolvedValue([ENABLED]);
    let resolveConnect: ((v: ConnectResultTuple) => void) | undefined;
    connect.mockImplementation(
      () =>
        new Promise<ConnectResultTuple>((r) => {
          resolveConnect = r;
        }),
    );

    const p1 = manager.load("agent-1");
    await new Promise((r) => setTimeout(r, 0));
    const p2 = manager.load("agent-1");
    resolveConnect!(okResult("fs", "t"));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.tools).toEqual(r2.tools);
    expect(loadServers).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("only connects enabled servers", async () => {
    loadServers.mockResolvedValue([ENABLED, DISABLED]);
    connect.mockResolvedValue(okResult("fs", "t"));

    await manager.load("agent-1");

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls.map((c) => c[0].id)).toEqual(["s1"]);
  });

  it("drops cached entries whose config was removed or disabled", async () => {
    loadServers.mockResolvedValueOnce([ENABLED, OTHER]);
    connect.mockResolvedValueOnce(okResult("fs", "mcp__fs__t"));
    connect.mockResolvedValueOnce(okResult("web", "mcp__web__t"));
    await manager.load("agent-1");

    loadServers.mockResolvedValueOnce([ENABLED]);
    const after = await manager.load("agent-1");
    expect(after.tools.map((t) => t.name)).toEqual(["mcp__fs__t"]);
  });

  it("invalidate closes the agent connections, bumps revision, and forces reconnect", async () => {
    loadServers.mockResolvedValue([ENABLED]);
    const first = okResult("fs", "v1");
    connect.mockResolvedValueOnce(first);
    await manager.load("agent-1");
    const revisionBefore = manager.revision("agent-1");
    expect(revisionBefore).toBe(1);

    await manager.invalidate("agent-1");
    expect(first.connection.close).toHaveBeenCalledTimes(1);
    expect(manager.revision("agent-1")).toBe(revisionBefore + 1);

    connect.mockResolvedValueOnce(okResult("fs", "v2"));
    const after = await manager.load("agent-1");
    expect(after.tools.map((t) => t.name)).toEqual(["v2"]);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("closeAll closes every agent's connections; further loads return empty", async () => {
    const configB: McpServerConfig = { ...ENABLED, id: "s9", name: "b" };
    loadServers.mockImplementation(async (agentId) => (agentId === "agent-a" ? [ENABLED] : [configB]));
    const a = okResult("a", "t-a");
    const b = okResult("b", "t-b");
    connect.mockResolvedValueOnce(a);
    connect.mockResolvedValueOnce(b);
    await manager.load("agent-a");
    await manager.load("agent-b");

    await manager.closeAll();
    expect(a.connection.close).toHaveBeenCalledTimes(1);
    expect(b.connection.close).toHaveBeenCalledTimes(1);

    const after = await manager.load("agent-a");
    expect(after.tools).toEqual([]);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  describe("failure handling and backoff (P1)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("a failed server is not cached as a permanent empty toolset and retries after backoff", async () => {
      vi.useFakeTimers();
      loadServers.mockResolvedValue([ENABLED]);
      connect.mockRejectedValueOnce(new Error("boom"));

      const first = await manager.load("agent-1");
      expect(first.tools).toEqual([]);
      expect(first.info).toEqual([]);

      await manager.load("agent-1");
      expect(connect).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(31_000);
      connect.mockResolvedValueOnce(okResult("fs", "mcp__fs__ok"));
      const second = await manager.load("agent-1");
      expect(second.tools.map((t) => t.name)).toEqual(["mcp__fs__ok"]);
      expect(connect).toHaveBeenCalledTimes(2);
    });

    it("a successful reconnect resets the backoff attempts", async () => {
      vi.useFakeTimers();
      loadServers.mockResolvedValue([ENABLED]);
      connect.mockRejectedValueOnce(new Error("boom"));
      await manager.load("agent-1");

      vi.advanceTimersByTime(31_000);
      let secondDisconnect: (() => void) | undefined;
      const second = okResult("fs", "t");
      connect.mockImplementationOnce(async (_server, _logger, opts: ConnectServerOptions) => {
        secondDisconnect = opts.onDisconnect;
        return second;
      });
      await manager.load("agent-1");

      second.connection.simulateDisconnect();
      secondDisconnect!();

      connect.mockRejectedValueOnce(new Error("boom2"));
      vi.advanceTimersByTime(1_000);
      await manager.load("agent-1");

      vi.advanceTimersByTime(30_000);
      connect.mockResolvedValueOnce(okResult("fs", "t"));
      await manager.load("agent-1");
      expect(connect).toHaveBeenCalledTimes(4);
    });

    it("partial failure keeps the healthy server's tools available", async () => {
      loadServers.mockResolvedValue([ENABLED, OTHER]);
      connect.mockImplementation(async (server: McpServerConfig) => {
        if (server.id === "s1") throw new Error("down");
        return okResult("web", "mcp__web__t");
      });

      const result = await manager.load("agent-1");
      expect(result.tools.map((t) => t.name)).toEqual(["mcp__web__t"]);
      expect(result.info).toHaveLength(1);
    });

    it("a connection that is closed immediately after connect is treated as a failure", async () => {
      loadServers.mockResolvedValue([ENABLED]);
      const dead = okResult("fs", "mcp__fs__t");
      dead.connection.simulateDisconnect();
      connect.mockResolvedValueOnce(dead);

      const result = await manager.load("agent-1");
      expect(result.tools).toEqual([]);
      expect(dead.connection.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("disconnect detection (P3)", () => {
    it("unexpected disconnect drops the entry and bumps the revision", async () => {
      loadServers.mockResolvedValue([ENABLED]);
      const result = okResult("fs", "mcp__fs__t");
      let onDisconnect: (() => void) | undefined;
      connect.mockImplementationOnce(async (_server, _logger, opts: ConnectServerOptions) => {
        onDisconnect = opts.onDisconnect;
        return result;
      });
      await manager.load("agent-1");
      const revisionBefore = manager.revision("agent-1");

      onDisconnect!();

      expect(manager.revision("agent-1")).toBe(revisionBefore + 1);
      const after = await manager.load("agent-1");
      expect(after.tools).toEqual([]);
    });

    it("disconnect of one server while another pass is in flight keeps the pass result", async () => {
      loadServers.mockResolvedValue([ENABLED, OTHER]);
      const fsResult = okResult("fs", "mcp__fs__t");
      let releaseOther: ((v: ConnectResultTuple) => void) | undefined;
      let fsDisconnect: (() => void) | undefined;
      connect.mockImplementation(async (server: McpServerConfig, _logger, opts: ConnectServerOptions) => {
        if (server.id === "s1") {
          fsDisconnect = opts.onDisconnect;
          return fsResult;
        }
        return new Promise<ConnectResultTuple>((r) => {
          releaseOther = r;
        });
      });

      const pending = manager.load("agent-1");
      await new Promise((r) => setTimeout(r, 0));
      fsResult.connection.simulateDisconnect();
      fsDisconnect!();
      releaseOther!(okResult("web", "mcp__web__t"));
      const result = await pending;

      expect(result.tools.map((t) => t.name)).toEqual(["mcp__web__t"]);
    });
  });

  describe("epoch guard against invalidate/closeAll races (P4)", () => {
    it("invalidate during an inflight pass closes fresh connections and returns no tools", async () => {
      loadServers.mockResolvedValue([ENABLED]);
      let resolveConnect: ((v: ConnectResultTuple) => void) | undefined;
      connect.mockImplementation(
        () =>
          new Promise<ConnectResultTuple>((r) => {
            resolveConnect = r;
          }),
      );

      const pending = manager.load("agent-1");
      await new Promise((r) => setTimeout(r, 0));
      await manager.invalidate("agent-1");
      const fresh = okResult("fs", "mcp__fs__t");
      resolveConnect!(fresh);
      const result = await pending;

      expect(result.tools).toEqual([]);
      expect(fresh.connection.close).toHaveBeenCalledTimes(1);
    });

    it("invalidate of one agent does not invalidate another agent's inflight pass", async () => {
      loadServers.mockImplementation(async (agentId) => (agentId === "agent-a" ? [ENABLED] : [OTHER]));
      let resolveConnect: ((v: ConnectResultTuple) => void) | undefined;
      connect.mockImplementationOnce(
        () =>
          new Promise<ConnectResultTuple>((r) => {
            resolveConnect = r;
          }),
      );

      const pendingA = manager.load("agent-a");
      await new Promise((r) => setTimeout(r, 0));
      await manager.invalidate("agent-b");
      resolveConnect!(okResult("fs", "mcp__fs__t"));
      const resultA = await pendingA;

      expect(resultA.tools.map((t) => t.name)).toEqual(["mcp__fs__t"]);
    });

    it("closeAll during an inflight pass closes fresh connections", async () => {
      loadServers.mockResolvedValue([ENABLED]);
      let resolveConnect: ((v: ConnectResultTuple) => void) | undefined;
      connect.mockImplementation(
        () =>
          new Promise<ConnectResultTuple>((r) => {
            resolveConnect = r;
          }),
      );

      const pending = manager.load("agent-1");
      await new Promise((r) => setTimeout(r, 0));
      await manager.closeAll();
      const fresh = okResult("fs", "mcp__fs__t");
      resolveConnect!(fresh);
      const result = await pending;

      expect(result.tools).toEqual([]);
      expect(fresh.connection.close).toHaveBeenCalledTimes(1);
    });
  });
});
