import { describe, expect, it } from "vitest";
import { categorizePath } from "../../access/path-category.js";


describe("categorizePath", () => {
  it("classifies the root index and changelog by exact match", () => {
    expect(categorizePath("AGENTS.md")).toBe("rootIndex");
    expect(categorizePath("CHANGELOG.md")).toBe("changelog");
  });

  it("classifies project config and theme", () => {
    expect(categorizePath(".spherse/project.yaml")).toBe("projectConfig");
    expect(categorizePath(".spherse/theme.css")).toBe("projectTheme");
  });

  it("classifies generated-images dir and its contents", () => {
    expect(categorizePath(".spherse/generated-images")).toBe("generatedImages");
    expect(categorizePath(".spherse/generated-images/hero.png")).toBe(
      "generatedImages",
    );
  });

  it("classifies skills dir and its contents", () => {
    expect(categorizePath(".spherse/skills")).toBe("skills");
    expect(categorizePath(".spherse/skills/my-skill/SKILL.md")).toBe("skills");
  });

  it("classifies agent files under an agent-id subdirectory", () => {
    expect(categorizePath(".spherse/agents/historian-abc123/profile.md")).toBe(
      "agentProfile",
    );
    expect(categorizePath(".spherse/agents/historian-abc123/theme.css")).toBe(
      "agentTheme",
    );
    expect(categorizePath(".spherse/agents/historian-abc123/sessions.db")).toBe(
      "agentSessions",
    );
  });

  it("classifies both agent trigger filenames", () => {
    expect(categorizePath(".spherse/agents/historian-abc123/triggers/index.yml")).toBe(
      "agentTriggers",
    );
    expect(
      categorizePath(".spherse/agents/historian-abc123/triggers/logs.jsonl"),
    ).toBe("agentTriggerLogs");
  });

  it("falls back to spherseOther for unknown files under .spherse/", () => {
    expect(categorizePath(".spherse/random.md")).toBe("spherseOther");
    expect(categorizePath(".spherse/foo/bar.json")).toBe("spherseOther");
  });

  it("classifies non-.spherse files as userFiles", () => {
    expect(categorizePath("docs/guide.md")).toBe("userFiles");
    expect(categorizePath("notes/secret.md")).toBe("userFiles");
    expect(categorizePath("README.md")).toBe("userFiles");
  });

  it("does not treat index lookalikes as rootIndex", () => {
    expect(categorizePath("AGENTS.md.bak")).toBe("userFiles");
    expect(categorizePath("AGENTS")).toBe("userFiles");
  });

  it("does not treat .spherse-prefixed siblings as spherse paths", () => {
    expect(categorizePath(".spherse-copy/secret.md")).toBe("userFiles");
    expect(categorizePath(".spherse-backup")).toBe("userFiles");
    expect(categorizePath(".sphersegenerated-images/x.png")).toBe("userFiles");
  });

  it("requires an agent-id segment and does not match files directly in the agents dir", () => {
    expect(categorizePath(".spherse/agents/profile.md")).toBe("spherseOther");
    expect(categorizePath(".spherse/agents/sessions.db")).toBe("spherseOther");
    expect(categorizePath(".spherse/agents/bot/sub/profile.md")).toBe("spherseOther");
  });

  it("normalizes backslash separators", () => {
    expect(
      categorizePath(".spherse\\agents\\historian-abc123\\profile.md"),
    ).toBe("agentProfile");
    expect(categorizePath(".spherse\\project.yaml")).toBe("projectConfig");
  });

  it("strips a leading ./ prefix", () => {
    expect(categorizePath("./AGENTS.md")).toBe("rootIndex");
    expect(categorizePath("./.spherse/project.yaml")).toBe("projectConfig");
    expect(categorizePath("./.spherse/agents/bot/profile.md")).toBe("agentProfile");
  });
});
