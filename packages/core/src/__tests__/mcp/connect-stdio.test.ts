import { describe, it, expect } from "vitest";
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

describe("connectMcpServer (stdio failure logging)", () => {
  it("logs captured stderr via log.error when the stdio command crashes during handshake", async () => {
    const config: McpServerConfig = {
      id: "fail",
      name: "failing",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: ["-e", "process.stderr.write('custom-boom-detail\\nsecond-line'); process.exit(1)"],
    };
    const { logger, entries } = makeCapturingLogger();

    await expect(connectMcpServer(config, logger)).rejects.toThrow();

    const errors = entries.filter((e) => e.level >= 50);
    expect(errors.length).toBeGreaterThan(0);
    const stderrLogged = errors.some((e) => e.data.stderr === "custom-boom-detail\nsecond-line");
    expect(stderrLogged).toBe(true);
  });

  it("logs log.error even when the command cannot be spawned (no stderr)", async () => {
    const config: McpServerConfig = {
      id: "missing",
      name: "missing-cmd",
      enabled: true,
      transport: "stdio",
      command: "this-command-definitely-does-not-exist-xyz",
    };
    const { logger, entries } = makeCapturingLogger();

    await expect(connectMcpServer(config, logger)).rejects.toThrow();

    const errors = entries.filter((e) => e.level >= 50);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("merges config.env on top of process.env so spawned child keeps PATH and overrides", async () => {
    const script = "process.stderr.write('FOO=' + process.env.SPHERSE_TEST_FOO + ';PATH_SET=' + (process.env.PATH ? 'yes' : 'no')); process.exit(1)";
    const config: McpServerConfig = {
      id: "env",
      name: "env-merge",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: ["-e", script],
      env: { SPHERSE_TEST_FOO: "bar" },
    };
    const { logger, entries } = makeCapturingLogger();

    await expect(connectMcpServer(config, logger)).rejects.toThrow();

    const errors = entries.filter((e) => e.level >= 50);
    expect(errors.length).toBeGreaterThan(0);
    const stderrLogged = errors.some((e) => e.data.stderr === "FOO=bar;PATH_SET=yes");
    expect(stderrLogged).toBe(true);
  });
});
