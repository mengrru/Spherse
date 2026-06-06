import { describe, expect, it } from "vitest";
import { normalizeAiDeniedPath } from "./useAiReadDenylist";

describe("normalizeAiDeniedPath", () => {
  it("normalizes valid relative paths", () => {
    expect(normalizeAiDeniedPath(" secrets\\key.md ")).toBe("secrets/key.md");
    expect(normalizeAiDeniedPath("./notes/private.md")).toBe("notes/private.md");
  });

  it("rejects empty input", () => {
    expect(normalizeAiDeniedPath("")).toBeNull();
    expect(normalizeAiDeniedPath("   ")).toBeNull();
  });

  it("rejects dot-only input", () => {
    expect(normalizeAiDeniedPath(".")).toBeNull();
  });

  it("rejects paths with parent traversal", () => {
    expect(normalizeAiDeniedPath("../secret.md")).toBeNull();
    expect(normalizeAiDeniedPath("foo/../bar")).toBeNull();
  });

  it("rejects absolute paths", () => {
    expect(normalizeAiDeniedPath("/secret.md")).toBeNull();
  });

  it("rejects reserved paths", () => {
    expect(normalizeAiDeniedPath("AGENTS.md")).toBeNull();
    expect(normalizeAiDeniedPath("CHANGELOG.md")).toBeNull();
    expect(normalizeAiDeniedPath(".spherse")).toBeNull();
    expect(normalizeAiDeniedPath(".spherse/project.yaml")).toBeNull();
  });

  it("collapses multiple slashes", () => {
    expect(normalizeAiDeniedPath("secrets///key.md")).toBe("secrets/key.md");
  });
});
