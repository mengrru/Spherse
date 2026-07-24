import { describe, it, expect, vi } from "vitest";
import { adaptMcpTool } from "../../mcp/mcp-client.js";

describe("adaptMcpTool", () => {
  it("builds a namespaced agent tool from an mcp tool descriptor", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
    });
    const tool = adaptMcpTool("Filesystem", "aabbccdd", {
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
    }, callTool);

    expect(tool.name).toBe("mcp__filesystem_aabbccdd__read_file");
    expect(tool.label).toBe("Filesystem / read_file");
    expect(tool.description).toBe("Read a file");

    const result = await tool.execute("call-1", { path: "/x" });
    expect(callTool).toHaveBeenCalledWith({ name: "read_file", arguments: { path: "/x" } }, undefined);
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.details).toEqual({ server: "Filesystem", tool: "read_file" });
  });

  it("maps image content through to image parts", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "image", data: "Qk==", mimeType: "image/png" }],
    });
    const tool = adaptMcpTool("img", "aabbccdd", { name: "snap" }, callTool);
    const result = await tool.execute("c", {});
    expect(result.content).toEqual([{ type: "image", data: "Qk==", mimeType: "image/png" }]);
  });

  it("returns error text when the mcp server reports isError", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
    const tool = adaptMcpTool("srv", "aabbccdd", { name: "do" }, callTool);
    const result = await tool.execute("c", {});
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toContain("failed");
    expect(result.details).toMatchObject({ error: expect.any(String) });
  });

  it("returns error text when callTool throws", async () => {
    const callTool = vi.fn().mockRejectedValue(new Error("network down"));
    const tool = adaptMcpTool("srv", "aabbccdd", { name: "do" }, callTool);
    const result = await tool.execute("c", {});
    expect((result.content[0] as { text: string }).text).toContain("network down");
  });

  it("uses a fallback description when the tool has none", () => {
    const tool = adaptMcpTool("srv", "aabbccdd", { name: "ping" }, vi.fn());
    expect(tool.description).toContain("ping");
    expect(tool.description).toContain("srv");
  });
});
