import { describe, it, expect, vi } from "vitest";
import { adaptMcpTool, adaptMcpReadResourceTool, adaptMcpGetPromptTool } from "../../mcp/mcp-client.js";

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

describe("adaptMcpReadResourceTool", () => {
  it("reads a text resource and returns TextContent", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: "file:///foo", text: "hello world" }],
    });
    const tool = adaptMcpReadResourceTool("FS", "aabbccdd", readResource);

    expect(tool.name).toBe("mcp__fs_aabbccdd__read_resource");
    expect(tool.label).toBe("FS / read_resource");

    const result = await tool.execute("c1", { uri: "file:///foo" });
    expect(readResource).toHaveBeenCalledWith("file:///foo", undefined);
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
    expect(result.details).toEqual({ server: "FS", uri: "file:///foo" });
  });

  it("maps image blob to ImageContent", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: "screenshot://1", blob: "Qk==", mimeType: "image/png" }],
    });
    const tool = adaptMcpReadResourceTool("srv", "aabbccdd", readResource);
    const result = await tool.execute("c", { uri: "screenshot://1" });
    expect(result.content).toEqual([{ type: "image", data: "Qk==", mimeType: "image/png" }]);
  });

  it("falls back to data URI for non-image blob", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: "data://x", blob: "AA==", mimeType: "application/pdf" }],
    });
    const tool = adaptMcpReadResourceTool("srv", "aabbccdd", readResource);
    const result = await tool.execute("c", { uri: "data://x" });
    expect((result.content[0] as { text: string }).text).toBe("data:application/pdf;base64,AA==");
  });

  it("returns fallback text when resource has no content", async () => {
    const readResource = vi.fn().mockResolvedValue({ contents: [] });
    const tool = adaptMcpReadResourceTool("srv", "aabbccdd", readResource);
    const result = await tool.execute("c", { uri: "empty://x" });
    expect((result.content[0] as { text: string }).text).toContain("no content");
  });

  it("returns error text when readResource throws", async () => {
    const readResource = vi.fn().mockRejectedValue(new Error("not found"));
    const tool = adaptMcpReadResourceTool("srv", "aabbccdd", readResource);
    const result = await tool.execute("c", { uri: "bad://x" });
    expect((result.content[0] as { text: string }).text).toContain("not found");
    expect(result.details).toMatchObject({ error: "not found" });
  });
});

describe("adaptMcpGetPromptTool", () => {
  it("serializes prompt messages into text", async () => {
    const getPrompt = vi.fn().mockResolvedValue({
      description: "A summary prompt",
      messages: [
        { role: "user", content: { type: "text", text: "Summarize this" } },
        { role: "assistant", content: { type: "text", text: "Sure" } },
      ],
    });
    const tool = adaptMcpGetPromptTool("srv", "aabbccdd", getPrompt);

    expect(tool.name).toBe("mcp__srv_aabbccdd__get_prompt");
    expect(tool.label).toBe("srv / get_prompt");

    const result = await tool.execute("c1", { name: "summarize", arguments: { path: "/x" } });
    expect(getPrompt).toHaveBeenCalledWith({ name: "summarize", arguments: { path: "/x" } }, undefined);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("[prompt: srv/summarize]");
    expect(text).toContain("description: A summary prompt");
    expect(text).toContain("<user>\nSummarize this\n</user>");
    expect(text).toContain("<assistant>\nSure\n</assistant>");
  });

  it("handles string content directly", async () => {
    const getPrompt = vi.fn().mockResolvedValue({
      messages: [{ role: "user", content: "plain string" }],
    });
    const tool = adaptMcpGetPromptTool("srv", "aabbccdd", getPrompt);
    const result = await tool.execute("c", { name: "p" });
    expect((result.content[0] as { text: string }).text).toContain("<user>\nplain string\n</user>");
  });

  it("JSON-stringifies non-text content", async () => {
    const getPrompt = vi.fn().mockResolvedValue({
      messages: [{ role: "user", content: { type: "image", data: "Qk==" } }],
    });
    const tool = adaptMcpGetPromptTool("srv", "aabbccdd", getPrompt);
    const result = await tool.execute("c", { name: "p" });
    expect((result.content[0] as { text: string }).text).toContain("Qk==");
  });

  it("returns error text when getPrompt throws", async () => {
    const getPrompt = vi.fn().mockRejectedValue(new Error("timeout"));
    const tool = adaptMcpGetPromptTool("srv", "aabbccdd", getPrompt);
    const result = await tool.execute("c", { name: "p" });
    expect((result.content[0] as { text: string }).text).toContain("timeout");
    expect(result.details).toMatchObject({ error: "timeout" });
  });
});
