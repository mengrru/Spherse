import { describe, it, expect } from "vitest";
import {
  buildProjectInstructions,
  buildAgentProfile,
  buildSessionContext,
  buildPreloadedContext,
} from "../../session/agent-assembly.js";
import { serializeBlocks } from "../../kernel/context-block.js";

describe("serializeBlocks", () => {
  describe("individual blocks", () => {
    it("serializes project-instructions", () => {
      const out = serializeBlocks([buildProjectInstructions("do good")]);
      expect(out).toBe("<project-instructions>\ndo good\n</project-instructions>");
    });

    it("returns null block for empty project instructions", () => {
      expect(buildProjectInstructions("   ")).toBeNull();
    });

    it("serializes agent-profile", () => {
      const out = serializeBlocks([buildAgentProfile("You are a test")]);
      expect(out).toBe("<agent-profile>\nYou are a test\n</agent-profile>");
    });

    it("returns null block for empty agent profile", () => {
      expect(buildAgentProfile("")).toBeNull();
    });

    it("serializes session-context with name, slug and session id", () => {
      const out = serializeBlocks([
        buildSessionContext({ name: "Helper", slug: "helper", sessionId: "s1" }),
      ]);
      expect(out).toBe(
        "<session-context>\nagent-name: Helper\nagent-slug: helper\nsession-id: s1\n</session-context>",
      );
    });

    it("includes alias when present; time perception is contributed by its capability, not session-context", async () => {
      const out = serializeBlocks([
        buildSessionContext({
          name: "Helper",
          alias: "小明",
          slug: "helper",
          sessionId: "s1",
        }),
      ]);
      expect(out).toContain("agent-alias: 小明");
      expect(out).not.toContain("time-perception");

      const { timePerceptionCapability } = await import("../../capabilities/time-perception/index.js");
      const view = {
        agentId: "a",
        profile: {
          timePerception: { enabled: true, epochMs: 0, startMs: 0, flowRate: 60 },
        },
      } as never;
      const blocks = await timePerceptionCapability().contextBlocks!(view);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].render()).toContain("time-perception: enabled");
      expect(blocks[0].render()).toContain("Do not output <time> tags");
    });

    it("serializes preloaded-context files", () => {
      const out = serializeBlocks([
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
      expect(serializeBlocks([null, null])).toBe("");
    });
  });

  it("combines all blocks with blank lines between sections", () => {
    const out = serializeBlocks([
      buildProjectInstructions("AGENTS"),
      buildAgentProfile("PROFILE"),
      buildSessionContext({ name: "N", slug: "n", sessionId: "s" }),
      buildPreloadedContext([{ path: "f.md", content: "x" }]),
    ]);
    const sections = out.split("\n\n");
    expect(sections).toHaveLength(4);
    expect(out).toContain("<project-instructions>\nAGENTS\n</project-instructions>");
    expect(out).toContain("<agent-profile>\nPROFILE\n</agent-profile>");
    expect(out).toContain("<session-context>");
    expect(out).toContain("<preloaded-context>");
  });
});
