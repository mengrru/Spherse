import { describe, it, expect } from "vitest";
import {
  normalizeMcpConfig,
  normalizeMcpServer,
  makeMcpToolName,
  generateMcpServerId,
  isMcpTransportType,
} from "../../mcp/config.js";

describe("isMcpTransportType", () => {
  it("accepts supported transports", () => {
    expect(isMcpTransportType("stdio")).toBe(true);
    expect(isMcpTransportType("http")).toBe(true);
    expect(isMcpTransportType("sse")).toBe(true);
  });

  it("rejects unsupported values", () => {
    expect(isMcpTransportType("ws")).toBe(false);
    expect(isMcpTransportType(undefined)).toBe(false);
    expect(isMcpTransportType(123)).toBe(false);
  });
});

describe("generateMcpServerId", () => {
  it("produces unique uuids", () => {
    const a = generateMcpServerId();
    const b = generateMcpServerId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("normalizeMcpServer", () => {
  it("normalizes a valid stdio server", () => {
    const result = normalizeMcpServer({
      id: "x",
      name: "fs",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "server"],
      env: { FOO: "bar" },
    });
    expect(result).toEqual({
      id: "x",
      name: "fs",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "server"],
      env: { FOO: "bar" },
    });
  });

  it("defaults enabled to true when omitted", () => {
    const result = normalizeMcpServer({
      id: "x",
      name: "fs",
      transport: "stdio",
      command: "npx",
    });
    expect(result?.enabled).toBe(true);
  });

  it("treats enabled=false explicitly", () => {
    const result = normalizeMcpServer({
      id: "x",
      name: "fs",
      enabled: false,
      transport: "stdio",
      command: "npx",
    });
    expect(result?.enabled).toBe(false);
  });

  it("normalizes an http server with headers", () => {
    const result = normalizeMcpServer({
      id: "h",
      name: "remote",
      enabled: true,
      transport: "http",
      url: "http://localhost/mcp",
      headers: { Authorization: "Bearer x" },
    });
    expect(result).toEqual({
      id: "h",
      name: "remote",
      enabled: true,
      transport: "http",
      url: "http://localhost/mcp",
      headers: { Authorization: "Bearer x" },
    });
  });

  it("strips empty args/env/headers", () => {
    const result = normalizeMcpServer({
      id: "x",
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: [],
      env: {},
    });
    expect(result).not.toHaveProperty("args");
    expect(result).not.toHaveProperty("env");
  });

  it("returns null for unsupported transport", () => {
    expect(normalizeMcpServer({ id: "x", name: "f", transport: "ws", url: "u" })).toBeNull();
  });

  it("returns null for stdio without command", () => {
    expect(normalizeMcpServer({ id: "x", name: "f", transport: "stdio", command: "  " })).toBeNull();
  });

  it("returns null for http without url", () => {
    expect(normalizeMcpServer({ id: "x", name: "f", transport: "http", url: "" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(normalizeMcpServer(null)).toBeNull();
    expect(normalizeMcpServer("x")).toBeNull();
  });
});

describe("normalizeMcpConfig", () => {
  it("dedupes servers by id and drops invalid entries", () => {
    const result = normalizeMcpConfig({
      servers: [
        { id: "a", name: "a", transport: "stdio", command: "c" },
        { id: "a", name: "dup", transport: "stdio", command: "d" },
        { id: "b", name: "b", transport: "ws" },
      ],
    });
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].name).toBe("a");
  });

  it("returns empty servers for malformed input", () => {
    expect(normalizeMcpConfig(null).servers).toEqual([]);
    expect(normalizeMcpConfig({}).servers).toEqual([]);
    expect(normalizeMcpConfig({ servers: "nope" }).servers).toEqual([]);
  });
});

describe("makeMcpToolName", () => {
  it("namespaces with sanitized server name + short id + tool name", () => {
    expect(makeMcpToolName("Filesystem", "aabbccdd-1122-3344", "read_file"))
      .toBe("mcp__filesystem_aabbccdd__read_file");
  });

  it("sanitizes server and tool segments", () => {
    expect(makeMcpToolName("My Server!", "aabbccdd", "search/query"))
      .toBe("mcp__my_server_aabbccdd__search_query");
  });

  it("keeps distinct namespaces for non-ascii (e.g. CJK) server names via short id", () => {
    const a = makeMcpToolName("文件系统", "11223344", "read");
    const b = makeMcpToolName("搜索", "55667788", "search");
    expect(a).toBe("mcp__11223344__read");
    expect(b).toBe("mcp__55667788__search");
    expect(a).not.toBe(b);
  });

  it("falls back to short id when server name is empty", () => {
    expect(makeMcpToolName("   ", "deadbeef", "ping")).toBe("mcp__deadbeef__ping");
  });

  it("falls back to 'tool' when tool name sanitizes to empty", () => {
    expect(makeMcpToolName("fs", "aabbccdd", "中文")).toBe("mcp__fs_aabbccdd__tool");
  });
});
