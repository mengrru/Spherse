import { describe, it, expect } from "vitest";
import {
  buildProjectInstructions,
  buildAgentProfile,
  buildSessionContext,
  buildSkillCatalog,
  buildPreloadedContext,
  serializeSystemPrompt,
} from "../../context/blocks.js";

describe("serializeSystemPrompt", () => {
  describe("individual blocks", () => {
    it("serializes project-instructions", () => {
      const out = serializeSystemPrompt([buildProjectInstructions("do good")]);
      expect(out).toBe("<project-instructions>\ndo good\n</project-instructions>");
    });

    it("returns null block for empty project instructions", () => {
      expect(buildProjectInstructions("   ")).toBeNull();
    });

    it("serializes agent-profile", () => {
      const out = serializeSystemPrompt([buildAgentProfile("You are a test")]);
      expect(out).toBe("<agent-profile>\nYou are a test\n</agent-profile>");
    });

    it("returns null block for empty agent profile", () => {
      expect(buildAgentProfile("")).toBeNull();
    });

    it("serializes session-context with name, slug and session id", () => {
      const out = serializeSystemPrompt([
        buildSessionContext({ name: "Helper", slug: "helper", sessionId: "s1" }),
      ]);
      expect(out).toBe(
        "<session-context>\nagent-name: Helper\nagent-slug: helper\nsession-id: s1\n</session-context>",
      );
    });

    it("includes alias and time perception when present", () => {
      const out = serializeSystemPrompt([
        buildSessionContext({
          name: "Helper",
          alias: "小明",
          slug: "helper",
          sessionId: "s1",
          timePerceptionEnabled: true,
        }),
      ]);
      expect(out).toContain("agent-alias: 小明");
      expect(out).toContain("time-perception: enabled");
      expect(out).toContain("Do not output <time> tags");
    });

    it("serializes skill-catalog escaping attributes", () => {
      const out = serializeSystemPrompt([
        buildSkillCatalog([
          { name: "write&style", description: 'Writes with "flair"' },
        ]),
      ]);
      expect(out).toContain('name="write&amp;style"');
      expect(out).toContain('description="Writes with &quot;flair&quot;"');
    });

    it("returns null block for empty skill catalog", () => {
      expect(buildSkillCatalog([])).toBeNull();
    });

    it("serializes preloaded-context files", () => {
      const out = serializeSystemPrompt([
        buildPreloadedContext([
          { path: "docs/guide.md", content: "# Guide" },
          { path: "notes.txt", content: "plain" },
        ]),
      ]);
      expect(out).toContain('<context-file path="docs/guide.md">\n# Guide\n</context-file>');
      expect(out).toContain('<context-file path="notes.txt">\nplain\n</context-file>');
    });

    it("returns null block for no files", () => {
      expect(buildPreloadedContext([])).toBeNull();
    });

    it("returns empty string when no block renders", () => {
      expect(serializeSystemPrompt([null, null])).toBe("");
    });
  });

  it("combines all blocks with blank lines between sections", () => {
    const out = serializeSystemPrompt([
      buildProjectInstructions("AGENTS"),
      buildAgentProfile("PROFILE"),
      buildSessionContext({ name: "N", slug: "n", sessionId: "s" }),
      buildSkillCatalog([{ name: "sk", description: "d" }]),
      buildPreloadedContext([{ path: "f.md", content: "x" }]),
    ]);
    const sections = out.split("\n\n");
    expect(sections).toHaveLength(5);
    expect(out).toContain("<project-instructions>\nAGENTS\n</project-instructions>");
    expect(out).toContain("<agent-profile>\nPROFILE\n</agent-profile>");
    expect(out).toContain("<session-context>");
    expect(out).toContain("<skill-catalog>");
    expect(out).toContain("<preloaded-context>");
  });
});
