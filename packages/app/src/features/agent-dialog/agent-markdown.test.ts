import { describe, expect, it } from "vitest";
import { buildAgentMarkdown, parseAgentMarkdown } from "./agent-markdown";

describe("parseAgentMarkdown", () => {
  it("returns empty tools when there is no frontmatter block", () => {
    const result = parseAgentMarkdown("# Title\n\nbody text");
    expect(result.formData.tools).toEqual([]);
    expect(result.formData.systemPrompt).toBe("# Title\n\nbody text");
  });

  it("returns empty tools when the tools field is missing", () => {
    const raw = "---\nname: Agent\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.tools).toEqual([]);
    expect(result.formData.name).toBe("Agent");
  });

  it("returns empty tools when the tools field is null", () => {
    const raw = "---\nname: Agent\ntools:\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.tools).toEqual([]);
  });

  it("returns empty tools when tools is an empty array", () => {
    const raw = "---\nname: Agent\ntools: []\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.tools).toEqual([]);
  });

  it("parses an explicit tools array", () => {
    const raw = "---\nname: Agent\ntools:\n  - read_file\n  - write_file\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.tools).toEqual(["read_file", "write_file"]);
  });

  it("filters out non-string entries in the tools array", () => {
    const raw = "---\nname: Agent\ntools:\n  - read_file\n  - 123\n  - write_file\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.tools).toEqual(["read_file", "write_file"]);
  });

  it("parses context array when present", () => {
    const raw = "---\nname: Agent\ncontext:\n  - file1.md\n  - file2.md\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.context).toEqual(["file1.md", "file2.md"]);
  });

  it("returns empty context when missing", () => {
    const raw = "---\nname: Agent\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.context).toEqual([]);
  });

  it("parses alias when present", () => {
    const raw = "---\nname: Agent\nalias: 小明\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.alias).toBe("小明");
  });

  it("returns undefined alias when missing", () => {
    const raw = "---\nname: Agent\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.alias).toBeUndefined();
  });

  it("does not leak alias into extra frontmatter", () => {
    const raw = "---\nname: Agent\nalias: 小明\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.extraFrontmatter).not.toHaveProperty("alias");
  });

  it("returns undefined alias when value is not a string", () => {
    const raw = "---\nname: Agent\nalias: 123\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.alias).toBeUndefined();
  });

  it("returns undefined alias when value is whitespace-only", () => {
    const raw = "---\nname: Agent\nalias: '   '\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.alias).toBeUndefined();
  });

  it("keeps extra frontmatter keys separate from form data", () => {
    const raw = "---\nname: Agent\nautoRun: true\nmodel: gpt-4\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.extraFrontmatter).toEqual({ autoRun: true, model: "gpt-4" });
  });

  it("handles CRLF line endings", () => {
    const raw = "---\r\nname: Agent\r\ntools:\r\n  - read_file\r\n---\r\n\r\nsystem prompt\r\n";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.tools).toEqual(["read_file"]);
    expect(result.formData.name).toBe("Agent");
  });
});

describe("buildAgentMarkdown", () => {
  it("writes tools array into frontmatter", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", tools: ["read_file"], context: [], systemPrompt: "hello" },
      {},
      false,
    );
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.tools).toEqual(["read_file"]);
    expect(parsed.formData.systemPrompt).toBe("hello");
  });

  it("omits context when empty", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", tools: [], context: [], systemPrompt: "hello" },
      {},
      false,
    );
    expect(md).not.toContain("context");
  });

  it("preserves empty tools array through a round-trip", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", tools: [], context: [], systemPrompt: "hello" },
      {},
      false,
    );
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.tools).toEqual([]);
  });

  it("writes alias into frontmatter when set", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", alias: "小明", tools: [], context: [], systemPrompt: "hello" },
      {},
      false,
    );
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.alias).toBe("小明");
  });

  it("omits alias from frontmatter when empty", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", alias: "", tools: [], context: [], systemPrompt: "hello" },
      {},
      false,
    );
    expect(md).not.toContain("alias");
  });

  it("omits alias from frontmatter when whitespace-only", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", alias: "   ", tools: [], context: [], systemPrompt: "hello" },
      {},
      false,
    );
    expect(md).not.toContain("alias");
  });

  it("preserves alias through a round-trip with extra frontmatter", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", alias: "小明", tools: ["read_file"], context: [], systemPrompt: "hello" },
      { model: "gpt-4" },
      false,
    );
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.alias).toBe("小明");
    expect(parsed.extraFrontmatter).toEqual({ model: "gpt-4" });
    expect(parsed.extraFrontmatter).not.toHaveProperty("alias");
  });
});
