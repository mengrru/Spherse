import { describe, expect, it } from "vitest";
import {
  isReservedDenyPath,
  normalizeDeniedPath,
  normalizeDeniedPaths,
  normalizeProjectRelativePath,
} from "../../access/denied-paths.js";


describe("normalizeProjectRelativePath", () => {
  it("normalizes valid project-relative paths", () => {
    expect(normalizeProjectRelativePath("lore/timeline.md")).toBe("lore/timeline.md");
    expect(normalizeProjectRelativePath("./notes/private.md")).toBe("notes/private.md");
    expect(normalizeProjectRelativePath("drafts/")).toBe("drafts");
    expect(normalizeProjectRelativePath(" secrets\\key.md ")).toBe("secrets/key.md");
  });

  it("rejects empty, root, path traversal, and absolute paths", () => {
    expect(normalizeProjectRelativePath("")).toBeNull();
    expect(normalizeProjectRelativePath("   ")).toBeNull();
    expect(normalizeProjectRelativePath(".")).toBeNull();
    expect(normalizeProjectRelativePath("..")).toBeNull();
    expect(normalizeProjectRelativePath("../secret.md")).toBeNull();
    expect(normalizeProjectRelativePath("/secret.md")).toBeNull();
  });

  it("normalizes backslash separators", () => {
    expect(normalizeProjectRelativePath("notes\\sub\\file.md")).toBe("notes/sub/file.md");
  });
});

describe("isReservedDenyPath", () => {
  it("reserves the root index and changelog", () => {
    expect(isReservedDenyPath("AGENTS.md")).toBe(true);
    expect(isReservedDenyPath("CHANGELOG.md")).toBe(true);
  });

  it("reserves the .spherse meta dir and its contents", () => {
    expect(isReservedDenyPath(".spherse")).toBe(true);
    expect(isReservedDenyPath(".spherse/project.yaml")).toBe(true);
    expect(isReservedDenyPath(".spherse/theme.css")).toBe(true);
    expect(isReservedDenyPath(".spherse/agents/x/profile.md")).toBe(true);
    expect(isReservedDenyPath(".spherse/generated-images/x.png")).toBe(true);
    expect(isReservedDenyPath(".spherse/skills/x/SKILL.md")).toBe(true);
  });

  it("does not reserve user files", () => {
    expect(isReservedDenyPath("lore/timeline.md")).toBe(false);
    expect(isReservedDenyPath("notes/secret.md")).toBe(false);
    expect(isReservedDenyPath("drafts/")).toBe(false);
    expect(isReservedDenyPath("README.md")).toBe(false);
  });
});

describe("normalizeDeniedPath", () => {
  it("accepts non-reserved paths", () => {
    expect(normalizeDeniedPath("lore/timeline.md")).toBe("lore/timeline.md");
    expect(normalizeDeniedPath("notes/secret.md")).toBe("notes/secret.md");
    expect(normalizeDeniedPath("drafts/")).toBe("drafts");
  });

  it("rejects reserved paths", () => {
    expect(normalizeDeniedPath("AGENTS.md")).toBeNull();
    expect(normalizeDeniedPath("CHANGELOG.md")).toBeNull();
    expect(normalizeDeniedPath(".spherse")).toBeNull();
    expect(normalizeDeniedPath(".spherse/project.yaml")).toBeNull();
    expect(normalizeDeniedPath(".spherse/agents/x/profile.md")).toBeNull();
    expect(normalizeDeniedPath(".spherse/theme.css")).toBeNull();
    expect(normalizeDeniedPath(".spherse/generated-images/x.png")).toBeNull();
    expect(normalizeDeniedPath(".spherse/skills/x/SKILL.md")).toBeNull();
  });

  it("rejects invalid paths", () => {
    expect(normalizeDeniedPath("")).toBeNull();
    expect(normalizeDeniedPath(".")).toBeNull();
    expect(normalizeDeniedPath("../secret.md")).toBeNull();
    expect(normalizeDeniedPath("/secret.md")).toBeNull();
  });

  it("normalizes backslash separators before categorizing", () => {
    expect(normalizeDeniedPath("secrets\\key.md")).toBe("secrets/key.md");
  });
});

describe("normalizeDeniedPaths", () => {
  it("deduplicates normalized paths", () => {
    expect(
      normalizeDeniedPaths(["secrets", "./secrets", "notes/a.md"]),
    ).toEqual(["secrets", "notes/a.md"]);
  });

  it("drops reserved and invalid entries while preserving order", () => {
    expect(
      normalizeDeniedPaths(
        ["AGENTS.md", ".spherse/project.yaml", "lore/x.md", "", "lore/x.md"],
      ),
    ).toEqual(["lore/x.md"]);
  });
});
