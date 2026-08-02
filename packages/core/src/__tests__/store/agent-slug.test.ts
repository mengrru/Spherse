import { describe, it, expect } from "vitest";
import { deriveAgentSlugBase, buildAgentDirName } from "../../store/agent-slug.js";

describe("deriveAgentSlugBase", () => {
  it("lowercases and hyphenates whitespace", () => {
    expect(deriveAgentSlugBase("World Builder")).toBe("world-builder");
    expect(deriveAgentSlugBase("  GPT   Writer  ")).toBe("gpt-writer");
  });

  it("keeps CJK characters", () => {
    expect(deriveAgentSlugBase("世界观 助手")).toBe("世界观-助手");
  });

  it("strips unsafe characters and path separators", () => {
    expect(deriveAgentSlugBase("a/b\\c.d")).toBe("abcd");
    expect(deriveAgentSlugBase("../../etc/passwd")).toBe("etcpasswd");
    expect(deriveAgentSlugBase("Editor (v2)!")).toBe("editor-v2");
  });

  it("collapses and trims hyphens", () => {
    expect(deriveAgentSlugBase("---foo---bar---")).toBe("foo-bar");
  });

  it("falls back to `agent` when nothing survives", () => {
    expect(deriveAgentSlugBase("")).toBe("agent");
    expect(deriveAgentSlugBase("   ")).toBe("agent");
    expect(deriveAgentSlugBase("!!!")).toBe("agent");
    expect(deriveAgentSlugBase("..")).toBe("agent");
  });

  it("truncates long names without trailing hyphen", () => {
    const slug = deriveAgentSlugBase("a".repeat(80));
    expect(slug).toHaveLength(40);
    const truncated = deriveAgentSlugBase(`${"b".repeat(39)} tail`);
    expect(truncated.endsWith("-")).toBe(false);
  });
});

describe("buildAgentDirName", () => {
  const id = "0123abcd-4567-89ef-0123-456789abcdef";

  it("appends a short id suffix", () => {
    expect(buildAgentDirName("writer", id, new Set())).toBe("writer-0123ab");
  });

  it("normalizes the slug base", () => {
    expect(buildAgentDirName("My Writer!", id, new Set())).toBe("my-writer-0123ab");
  });

  it("widens the id suffix on collision", () => {
    const taken = new Set(["writer-0123ab"]);
    expect(buildAgentDirName("writer", id, taken)).toBe("writer-0123abcd");
  });

  it("falls back to a numeric discriminator when all id widths collide", () => {
    const taken = new Set([
      "writer-0123ab",
      "writer-0123abcd",
      "writer-0123abcd45",
      "writer-0123abcd4567",
    ]);
    expect(buildAgentDirName("writer", id, taken)).toBe("writer-0123abcd4567-2");
  });
});
