import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { McpConfigStore } from "../../store/mcp-config.js";
import { createTempProject, cleanupDir, ensureDir, pathExists } from "../helpers.js";

describe("McpConfigStore", () => {
  let agentDir: string;
  let store: McpConfigStore;
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await createTempProject();
    agentDir = path.join(tmpRoot, "agents", "test-agent-a1b2c3");
    await ensureDir(tmpRoot, "agents/test-agent-a1b2c3");
    store = new McpConfigStore(agentDir);
  });

  afterEach(async () => {
    await cleanupDir(tmpRoot);
  });

  it("getConfig returns empty config when mcp.json missing", async () => {
    const config = await store.getConfig();
    expect(config.servers).toEqual([]);
  });

  it("saveConfig writes normalized config and getConfig reads it back", async () => {
    const saved = await store.saveConfig({
      servers: [
        {
          id: "a",
          name: "fs",
          enabled: true,
          transport: "stdio",
          command: "npx",
          args: ["-y", "srv"],
        },
      ],
    });
    expect(saved.servers).toHaveLength(1);

    const read = await store.getConfig();
    expect(read.servers).toHaveLength(1);
    expect(read.servers[0]).toEqual({
      id: "a",
      name: "fs",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "srv"],
    });
    expect(pathExists(agentDir, "mcp.json")).toBe(true);
  });

  it("saveConfig drops invalid servers on write", async () => {
    const saved = await store.saveConfig({
      servers: [
        { id: "ok", name: "ok", enabled: true, transport: "stdio", command: "c" },
        { id: "bad", name: "bad", enabled: true, transport: "ws" },
      ],
    });
    expect(saved.servers).toHaveLength(1);
    expect(saved.servers[0].id).toBe("ok");
  });

  it("getConfig dedupes servers by id on read", async () => {
    await store.saveConfig({
      servers: [
        { id: "dup", name: "first", enabled: true, transport: "stdio", command: "a" },
        { id: "dup", name: "second", enabled: true, transport: "stdio", command: "b" },
      ],
    });
    const read = await store.getConfig();
    expect(read.servers).toHaveLength(1);
    expect(read.servers[0].name).toBe("first");
  });
});
