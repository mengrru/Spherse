import { describe, it, expect } from "vitest";
import {
  buildProjectInstructions,
  buildAgentProfile,
  buildSessionContext,
  buildSkillCatalog,
  buildPreloadedContext,
  buildMcpContext,
  type ContextBlock,
} from "../../context/blocks.js";
import { serializeSystemPrompt } from "../../context/serialize.js";

describe("serializeSystemPrompt", () => {
  describe("individual blocks", () => {
    it("serializes project-instructions", () => {
      const out = serializeSystemPrompt([
        { kind: "project-instructions", content: "do good" },
      ]);
      expect(out).toBe(
        `<project-instructions>\ndo good\n</project-instructions>`,
      );
    });

    it("serializes agent-profile", () => {
      const out = serializeSystemPrompt([
        { kind: "agent-profile", content: "you are an agent" },
      ]);
      expect(out).toBe(`<agent-profile>\nyou are an agent\n</agent-profile>`);
    });

    it("serializes skill-catalog with self-closing items", () => {
      const out = serializeSystemPrompt([
        {
          kind: "skill-catalog",
          skills: [
            { name: "create-ui-theme", description: "Create a UI theme" },
            { name: "write-html", description: "Write HTML output" },
          ],
        },
      ]);
      expect(out).toBe(
        `<skill-catalog>\n` +
          `<skill-item name="create-ui-theme" description="Create a UI theme"/>\n` +
          `<skill-item name="write-html" description="Write HTML output"/>\n` +
          `</skill-catalog>`,
      );
    });

    it("serializes session-context without alias", () => {
      const out = serializeSystemPrompt([
        {
          kind: "session-context",
          meta: { name: "Test", slug: "test-abc", sessionId: "s1" },
        },
      ]);
      expect(out).toBe(
        `<session-context>\nagent-name: Test\nagent-slug: test-abc\nsession-id: s1\n</session-context>`,
      );
    });

    it("serializes session-context with alias", () => {
      const out = serializeSystemPrompt([
        {
          kind: "session-context",
          meta: { name: "Test", alias: "小明", slug: "test-abc", sessionId: "s1" },
        },
      ]);
      expect(out).toBe(
        `<session-context>\nagent-name: Test\nagent-alias: 小明\nagent-slug: test-abc\nsession-id: s1\n</session-context>`,
      );
    });

    it("serializes preloaded-context", () => {
      const out = serializeSystemPrompt([
        {
          kind: "preloaded-context",
          files: [{ path: "world/magic-system.md", content: "magic!" }],
        },
      ]);
      expect(out).toBe(
        `<preloaded-context>\n` +
          `<context-file path="world/magic-system.md">\nmagic!\n</context-file>\n` +
          `</preloaded-context>`,
      );
    });

    it("serializes mcp-context with instructions, resources and prompts", () => {
      const out = serializeSystemPrompt([
        {
          kind: "mcp-context",
          servers: [
            {
              serverName: "FS",
              serverId: "s1",
              instructions: "Use URIs starting with file://",
              capabilities: { resources: true, prompts: true },
              resources: [
                { uri: "file:///foo", name: "foo", description: "a file", mimeType: "text/plain" },
              ],
              resourceTemplates: [
                { uriTemplate: "file:///{path}", name: "files", description: "any file" },
              ],
              prompts: [
                {
                  name: "summarize",
                  description: "Summarize",
                  arguments: [{ name: "path", required: true, description: "File path" }],
                },
              ],
            },
          ],
        },
      ]);
      expect(out).toBe(
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

    it("omits empty sections in mcp-context", () => {
      const out = serializeSystemPrompt([
        {
          kind: "mcp-context",
          servers: [
            {
              serverName: "srv",
              serverId: "s1",
              capabilities: { resources: false },
              resources: [],
              resourceTemplates: [],
              prompts: [],
            },
          ],
        },
      ]);
      expect(out).toBe(
        `<mcp-context>\n<server name="srv">\n\n</server>\n</mcp-context>`,
      );
    });

    it("serializes multiple servers in mcp-context", () => {
      const out = serializeSystemPrompt([
        {
          kind: "mcp-context",
          servers: [
            {
              serverName: "a",
              serverId: "s1",
              instructions: "rules-a",
              capabilities: {},
              resources: [],
              resourceTemplates: [],
              prompts: [],
            },
            {
              serverName: "b",
              serverId: "s2",
              capabilities: { prompts: true },
              resources: [],
              resourceTemplates: [],
              prompts: [{ name: "p", description: "d" }],
            },
          ],
        },
      ]);
      expect(out).toContain(`<server name="a">`);
      expect(out).toContain(`<server name="b" capabilities="prompts">`);
      expect(out).toContain(`rules-a`);
      expect(out).toContain(`<prompt name="p" description="d"></prompt>`);
    });
  });

  it("combines all 5 blocks with blank lines between sections", () => {
    const blocks: Array<ContextBlock> = [
      { kind: "project-instructions", content: "AGENTS" },
      { kind: "agent-profile", content: "PROFILE" },
      {
        kind: "session-context",
        meta: { name: "A", alias: "AA", slug: "a-x", sessionId: "s1" },
      },
      {
        kind: "skill-catalog",
        skills: [{ name: "a", description: "A skill" }],
      },
      {
        kind: "preloaded-context",
        files: [{ path: "f.md", content: "FILE" }],
      },
    ];
    const out = serializeSystemPrompt(blocks);
    expect(out).toBe(
      `<project-instructions>\nAGENTS\n</project-instructions>\n\n` +
        `<agent-profile>\nPROFILE\n</agent-profile>\n\n` +
        `<session-context>\nagent-name: A\nagent-alias: AA\nagent-slug: a-x\nsession-id: s1\n</session-context>\n\n` +
        `<skill-catalog>\n<skill-item name="a" description="A skill"/>\n</skill-catalog>\n\n` +
        `<preloaded-context>\n<context-file path="f.md">\nFILE\n</context-file>\n</preloaded-context>`,
    );
  });

  it("filters out null blocks", () => {
    const out = serializeSystemPrompt([
      null,
      { kind: "agent-profile", content: "x" },
      null,
      { kind: "project-instructions", content: "y" },
    ]);
    expect(out).toBe(
      `<agent-profile>\nx\n</agent-profile>\n\n<project-instructions>\ny\n</project-instructions>`,
    );
  });

  it("returns empty string for empty array", () => {
    expect(serializeSystemPrompt([])).toBe("");
  });

  it("returns empty string for all-null array", () => {
    expect(serializeSystemPrompt([null, null])).toBe("");
  });

  it("XML-escapes special chars in skill attributes", () => {
    const out = serializeSystemPrompt([
      {
        kind: "skill-catalog",
        skills: [
          { name: 'evil"name', description: "a <b> & c" },
        ],
      },
    ]);
    expect(out).toContain('name="evil&quot;name"');
    expect(out).toContain('description="a &lt;b&gt; &amp; c"');
  });

  it("XML-escapes special chars in context-file path attribute", () => {
    const out = serializeSystemPrompt([
      {
        kind: "preloaded-context",
        files: [{ path: 'a"b<c>.md', content: "x" }],
      },
    ]);
    expect(out).toContain('path="a&quot;b&lt;c&gt;.md"');
  });

  it("does NOT escape special characters in inner content", () => {
    const out = serializeSystemPrompt([
      { kind: "project-instructions", content: "use <b>bold</b> & stuff" },
    ]);
    expect(out).toBe(
      `<project-instructions>\nuse <b>bold</b> & stuff\n</project-instructions>`,
    );
  });
});

describe("block builders", () => {
  describe("buildProjectInstructions", () => {
    it("returns null for empty string", () => {
      expect(buildProjectInstructions("")).toBeNull();
    });
    it("returns null for whitespace-only string", () => {
      expect(buildProjectInstructions("   \n\t ")).toBeNull();
    });
    it("returns a block for non-empty content", () => {
      const block = buildProjectInstructions("hello");
      expect(block).toEqual({ kind: "project-instructions", content: "hello" });
    });
  });

  describe("buildAgentProfile", () => {
    it("returns null for empty string", () => {
      expect(buildAgentProfile("")).toBeNull();
    });
    it("returns null for whitespace-only string", () => {
      expect(buildAgentProfile("\n  \t")).toBeNull();
    });
    it("returns a block for non-empty content", () => {
      const block = buildAgentProfile("profile text");
      expect(block).toEqual({ kind: "agent-profile", content: "profile text" });
    });
  });

  describe("buildSessionContext", () => {
    it("returns a block for valid meta", () => {
      const block = buildSessionContext({
        name: "A",
        slug: "a-x",
        sessionId: "s1",
      });
      expect(block).toEqual({
        kind: "session-context",
        meta: { name: "A", slug: "a-x", sessionId: "s1" },
      });
    });

    it("includes alias when provided", () => {
      const block = buildSessionContext({
        name: "A",
        alias: "别名",
        slug: "a-x",
        sessionId: "s1",
      });
      expect(block).toEqual({
        kind: "session-context",
        meta: { name: "A", alias: "别名", slug: "a-x", sessionId: "s1" },
      });
    });
  });

  describe("buildSkillCatalog", () => {
    it("returns null for empty skills array", () => {
      expect(buildSkillCatalog([])).toBeNull();
    });
    it("returns a block for non-empty skills", () => {
      const block = buildSkillCatalog([
        { name: "a", description: "desc" },
      ]);
      expect(block).toEqual({
        kind: "skill-catalog",
        skills: [{ name: "a", description: "desc" }],
      });
    });
  });

  describe("buildPreloadedContext", () => {
    it("returns null for empty files array", () => {
      expect(buildPreloadedContext([])).toBeNull();
    });
    it("returns a block for non-empty files", () => {
      const block = buildPreloadedContext([
        { path: "f.md", content: "x" },
      ]);
      expect(block).toEqual({
        kind: "preloaded-context",
        files: [{ path: "f.md", content: "x" }],
      });
    });
  });

  describe("buildMcpContext", () => {
    const empty = (name: string) => ({
      serverName: name,
      serverId: "s",
      resources: [],
      resourceTemplates: [],
      prompts: [],
    });

    it("returns null when all servers are empty", () => {
      expect(buildMcpContext([empty("a"), empty("b")])).toBeNull();
    });

    it("returns null for empty array", () => {
      expect(buildMcpContext([])).toBeNull();
    });

    it("filters out servers with only whitespace instructions and no resources/prompts", () => {
      const block = buildMcpContext([
        { ...empty("a"), instructions: "   " },
        { ...empty("b"), instructions: "real" },
      ]);
      expect(block).not.toBeNull();
      expect(block!.servers).toHaveLength(1);
      expect(block!.servers[0].serverName).toBe("b");
    });

    it("keeps servers with resources even without instructions", () => {
      const block = buildMcpContext([
        { ...empty("a"), resources: [{ uri: "u", name: "n" }] },
      ]);
      expect(block).not.toBeNull();
      expect(block!.servers[0].serverName).toBe("a");
    });

    it("keeps servers with prompts even without instructions", () => {
      const block = buildMcpContext([
        { ...empty("a"), prompts: [{ name: "p" }] },
      ]);
      expect(block).not.toBeNull();
      expect(block!.servers[0].serverName).toBe("a");
    });
  });
});
