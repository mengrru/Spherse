import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { connectMcpServer } from "../../mcp/mcp-client.js";
import type { McpServerConfig } from "../../mcp/types.js";

function makeCapturingLogger() {
  const entries: Array<{ level: number; msg: string; data: Record<string, unknown> }> = [];
  const logger = pino(
    { level: "debug" },
    {
      write(raw: string) {
        const parsed = JSON.parse(raw) as { level: number; msg: string } & Record<string, unknown>;
        const { level, msg, ...rest } = parsed;
        entries.push({ level, msg, data: rest });
      },
    },
  );
  return { logger, entries };
}

const FIXTURE_SERVER = `
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }
const exitAfterList = process.env.FIXTURE_EXIT_AFTER_LIST === "1";
const hangToolsList = process.env.FIXTURE_HANG_TOOLS_LIST === "1";
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } } });
  } else if (msg.method === "server/discover") {
    send({ jsonrpc: "2.0", id: msg.id, result: { resultType: "complete", supportedVersions: ["2025-11-25"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "fixture", version: "1.0.0" } } } });
  } else if (msg.method === "tools/list") {
    if (hangToolsList) return;
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "echo input", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] } });
    if (exitAfterList) setTimeout(() => process.exit(0), 300);
  }
});
`;

function stdioConfig(id: string, name: string, env?: Record<string, string>): McpServerConfig {
  return {
    id,
    name,
    enabled: true,
    transport: "stdio",
    command: process.execPath,
    args: ["-e", FIXTURE_SERVER],
    env,
  };
}

describe("connectMcpServer (connection lifecycle)", () => {
  it("connects to a real stdio server and returns its tools", async () => {
    const { result } = await connectMcpServer(stdioConfig("ok", "fixture"), undefined).then(
      (r) => ({ result: r }),
      (err) => {
        throw err;
      },
    );
    expect(result.tools.map((t) => t.name)).toEqual(["mcp__fixture_ok__echo"]);
    expect(result.connection.closed).toBe(false);
    await result.connection.close();
    expect(result.connection.closed).toBe(true);
  });

  it("fires onDisconnect when the server process dies unexpectedly", async () => {
    const onDisconnect = vi.fn();
    const result = await connectMcpServer(
      stdioConfig("die", "fixture", { FIXTURE_EXIT_AFTER_LIST: "1" }),
      undefined,
      { onDisconnect },
    );
    expect(result.tools).toHaveLength(1);

    await vi.waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  it("does not fire onDisconnect for deliberate close", async () => {
    const onDisconnect = vi.fn();
    const result = await connectMcpServer(stdioConfig("bye", "fixture"), undefined, {
      onDisconnect,
    });
    await result.connection.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("rejects within the signal budget when the server never responds", async () => {
    const config: McpServerConfig = {
      id: "hang",
      name: "hanging",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: ["-e", "process.stdin.resume()"],
    };
    await expect(
      connectMcpServer(config, undefined, { signal: AbortSignal.timeout(300) }),
    ).rejects.toThrow();
  });

  it("rejects within the signal budget when the handshake succeeds but tools/list hangs", async () => {
    const config: McpServerConfig = {
      ...stdioConfig("hanglist", "fixture"),
      env: { FIXTURE_HANG_TOOLS_LIST: "1" },
    };
    await expect(
      connectMcpServer(config, undefined, { signal: AbortSignal.timeout(800) }),
    ).rejects.toThrow("connect budget exceeded");
  });

  it("caps the stderr capture buffer at 8KB keeping the tail", async () => {
    const script = `
      process.stderr.write("HEAD_MARKER" + "x".repeat(20 * 1024) + "TAIL_MARKER");
      const readline = require("readline");
      readline.createInterface({ input: process.stdin }).on("line", (line) => {
        let msg; try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "server/discover") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { resultType: "complete", supportedVersions: ["2025-11-25"], capabilities: {}, _meta: { "io.modelcontextprotocol/serverInfo": { name: "noisy", version: "1.0.0" } } } }) + "\\n");
        }
      });
    `;
    const config: McpServerConfig = {
      id: "noisy",
      name: "noisy",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: ["-e", script],
    };
    const { logger, entries } = makeCapturingLogger();

    await expect(
      connectMcpServer(config, logger, { signal: AbortSignal.timeout(800) }),
    ).rejects.toThrow();

    const errors = entries.filter((e) => e.level >= 50 && typeof e.data.stderr === "string");
    expect(errors.length).toBeGreaterThan(0);
    const stderr = errors[0].data.stderr as string;
    expect(stderr.length).toBeLessThanOrEqual(8 * 1024);
    expect(stderr).toContain("TAIL_MARKER");
    expect(stderr).not.toContain("HEAD_MARKER");
  });
});
