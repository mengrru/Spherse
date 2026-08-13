import { describe, expect, it } from "vitest";
import { buildAgentMarkdown, parseAgentMarkdown } from "./agent-markdown";

describe("parseAgentMarkdown", () => {
  it("returns empty tools when there is no frontmatter block", () => {
    const result = parseAgentMarkdown("# Title\n\nbody text");
    expect(result.formData.tools).toEqual([]);
    expect(result.formData.systemPrompt).toBe("# Title\n\nbody text");
    expect(result.formData.yolo).toBe(false);
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

  it("returns undefined timePerception when field is missing", () => {
    const raw = "---\nname: Agent\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.timePerception).toBeUndefined();
  });

  it("parses timePerception when present", () => {
    const raw = [
      "---",
      "name: Agent",
      "timePerception:",
      "  enabled: true",
      "  epochMs: 1700000000000",
      "  startMs: 1600000000000",
      "  flowRate: 60",
      "  timeZone: Asia/Shanghai",
      "---",
      "",
      "system prompt",
    ].join("\n");
    const result = parseAgentMarkdown(raw);
    expect(result.formData.timePerception).toEqual({
      enabled: true,
      epochMs: 1700000000000,
      startMs: 1600000000000,
      flowRate: 60,
      timeZone: "Asia/Shanghai",
    });
  });

  it("does not leak timePerception into extra frontmatter", () => {
    const raw = "---\nname: Agent\ntimePerception:\n  enabled: true\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.extraFrontmatter).not.toHaveProperty("timePerception");
  });

  it("returns false yolo when field is missing", () => {
    const raw = "---\nname: Agent\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.yolo).toBe(false);
  });

  it("parses yolo true when present", () => {
    const raw = "---\nname: Agent\nyolo: true\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.yolo).toBe(true);
  });

  it("parses yolo false when explicitly false", () => {
    const raw = "---\nname: Agent\nyolo: false\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.formData.yolo).toBe(false);
  });

  it("does not leak yolo into extra frontmatter", () => {
    const raw = "---\nname: Agent\nyolo: true\n---\n\nsystem prompt";
    const result = parseAgentMarkdown(raw);
    expect(result.extraFrontmatter).not.toHaveProperty("yolo");
  });
});

describe("buildAgentMarkdown", () => {
  it("writes tools array into frontmatter", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", tools: ["read_file"], context: [], systemPrompt: "hello", yolo: false },
      {},
      false,
    );
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.tools).toEqual(["read_file"]);
    expect(parsed.formData.systemPrompt).toBe("hello");
  });

  it("omits context when empty", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", tools: [], context: [], systemPrompt: "hello", yolo: false },
      {},
      false,
    );
    expect(md).not.toContain("context");
  });

  it("preserves empty tools array through a round-trip", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", tools: [], context: [], systemPrompt: "hello", yolo: false },
      {},
      false,
    );
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.tools).toEqual([]);
  });

  it("writes alias into frontmatter when set", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", alias: "小明", tools: [], context: [], systemPrompt: "hello", yolo: false },
      {},
      false,
    );
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.alias).toBe("小明");
  });

  it("omits alias from frontmatter when empty", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", alias: "", tools: [], context: [], systemPrompt: "hello", yolo: false },
      {},
      false,
    );
    expect(md).not.toContain("alias");
  });

  it("omits alias from frontmatter when whitespace-only", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", alias: "   ", tools: [], context: [], systemPrompt: "hello", yolo: false },
      {},
      false,
    );
    expect(md).not.toContain("alias");
  });

  it("preserves alias through a round-trip with extra frontmatter", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", alias: "小明", tools: ["read_file"], context: [], systemPrompt: "hello", yolo: false },
      { model: "gpt-4" },
      false,
    );
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.alias).toBe("小明");
    expect(parsed.extraFrontmatter).toEqual({ model: "gpt-4" });
    expect(parsed.extraFrontmatter).not.toHaveProperty("alias");
  });

  it("writes timePerception when enabled", () => {
    const md = buildAgentMarkdown(
      {
        name: "Agent",
        tools: [],
        context: [],
        systemPrompt: "hello",
        yolo: false,
        timePerception: {
          enabled: true,
          epochMs: 1700000000000,
          startMs: 1600000000000,
          flowRate: 60,
          timeZone: "Asia/Shanghai",
        },
      },
      {},
      false,
    );
    expect(md).toContain("timePerception");
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.timePerception).toEqual({
      enabled: true,
      epochMs: 1700000000000,
      startMs: 1600000000000,
      flowRate: 60,
      timeZone: "Asia/Shanghai",
    });
  });

  it("omits timePerception when disabled", () => {
    const md = buildAgentMarkdown(
      {
        name: "Agent",
        tools: [],
        context: [],
        systemPrompt: "hello",
        yolo: false,
        timePerception: { enabled: false, epochMs: 1700000000000 },
      },
      {},
      false,
    );
    expect(md).not.toContain("timePerception");
  });

  it("writes yolo into frontmatter when true", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", tools: [], context: [], systemPrompt: "hello", yolo: true },
      {},
      false,
    );
    expect(md).toContain("yolo");
    const parsed = parseAgentMarkdown(md);
    expect(parsed.formData.yolo).toBe(true);
  });

  it("omits yolo from frontmatter when false", () => {
    const md = buildAgentMarkdown(
      { name: "Agent", tools: [], context: [], systemPrompt: "hello", yolo: false },
      {},
      false,
    );
    expect(md).not.toContain("yolo");
  });
});
