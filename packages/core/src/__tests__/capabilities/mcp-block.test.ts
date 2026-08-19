import { describe, expect, it } from "vitest";
import { mcpContextBlock } from "../../capabilities/mcp/block.js";
import type { McpServerInfo } from "../../mcp/types.js";

function server(partial: Partial<McpServerInfo>): McpServerInfo {
  return {
    serverName: "srv",
    serverId: "s1",
    instructions: "",
    capabilities: {},
    resources: [],
    resourceTemplates: [],
    prompts: [],
    ...partial,
  } as McpServerInfo;
}

describe("mcpContextBlock", () => {
  it("returns null when no server has meaningful content", () => {
    expect(mcpContextBlock([server({})])).toBeNull();
  });

  it("renders instructions, resources and prompts", () => {
    const block = mcpContextBlock([
      server({
        serverName: "FS",
        instructions: "Use URIs starting with file://",
        capabilities: { resources: true, prompts: true },
        resources: [{ uri: "file:///foo", name: "foo", description: "a file", mimeType: "text/plain" }],
        resourceTemplates: [{ uriTemplate: "file:///{path}", name: "files", description: "any file" }],
        prompts: [
          { name: "summarize", description: "Summarize", arguments: [{ name: "path", required: true, description: "File path" }] },
        ],
      }),
    ]);
    expect(block).not.toBeNull();
    expect(block!.render()).toBe(
      `<mcp-context>\n` +
        `<server name="FS" capabilities="resources,prompts">\n` +
        `<instructions>\nUse URIs starting with file://\n</instructions>\n` +
        `<resources>\n` +
        `<resource uri="file:///foo" name="foo" description="a file" mimeType="text/plain"/>\n` +
        `<resource-template uriTemplate="file:///{path}" name="files" description="any file"/>\n` +
        `</resources>\n` +
        `<prompts>\n` +
        `<prompt name="summarize" description="Summarize">\n` +
        `<arg name="path" required="true" description="File path"/>\n` +
        `</prompt>\n` +
        `</prompts>\n` +
        `</server>\n` +
        `</mcp-context>`,
    );
  });

  it("renders multiple servers and omits meaningless ones", () => {
    const block = mcpContextBlock([
      server({ serverName: "empty" }),
      server({
        serverName: "a",
        instructions: "rules-a",
      }),
      server({
        serverName: "b",
        capabilities: { prompts: true },
        prompts: [{ name: "p", description: "d" }],
      }),
    ]);
    expect(block).not.toBeNull();
    const text = block!.render();
    expect(text).not.toContain(`<server name="empty"`);
    expect(text).toContain(`<server name="a">`);
    expect(text).toContain(`<server name="b" capabilities="prompts">`);
    expect(text).toContain(`rules-a`);
    expect(text).toContain(`<prompt name="p" description="d"></prompt>`);
  });
});
