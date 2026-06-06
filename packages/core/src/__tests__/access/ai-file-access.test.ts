import { describe, expect, it } from "vitest";
import {
  createAiFileAccessPolicy,
  normalizeDeniedPath,
  normalizeDeniedPaths,
} from "../../access/ai-file-access.js";

describe("ai-file-access", () => {
  it("normalizes valid project-relative paths", () => {
    expect(normalizeDeniedPath(" secrets\\key.md ")).toBe("secrets/key.md");
    expect(normalizeDeniedPath("./notes/private.md")).toBe("notes/private.md");
  });

  it("rejects empty, root, path traversal, and absolute paths", () => {
    expect(normalizeDeniedPath("")).toBeNull();
    expect(normalizeDeniedPath(".")).toBeNull();
    expect(normalizeDeniedPath("../secret.md")).toBeNull();
    expect(normalizeDeniedPath("/secret.md")).toBeNull();
  });

  it("rejects reserved project mechanism paths", () => {
    expect(normalizeDeniedPath("AGENTS.md")).toBeNull();
    expect(normalizeDeniedPath("CHANGELOG.md")).toBeNull();
    expect(normalizeDeniedPath(".spherse")).toBeNull();
    expect(normalizeDeniedPath(".spherse/project.yaml")).toBeNull();
  });

  it("deduplicates normalized paths", () => {
    expect(normalizeDeniedPaths(["secrets", "./secrets", "notes/a.md"])).toEqual([
      "secrets",
      "notes/a.md",
    ]);
  });

  it("matches files and recursive directory children without prefix false positives", () => {
    const policy = createAiFileAccessPolicy("/project", ["secrets", "notes/private.md"]);

    expect(policy.isDenied("secrets")).toBe(true);
    expect(policy.isDenied("secrets/key.md")).toBe(true);
    expect(policy.isDenied("notes/private.md")).toBe(true);
    expect(policy.isDenied("secret-notes/key.md")).toBe(false);
    expect(policy.isDenied("notes/public.md")).toBe(false);
  });

  it("denies invalid checked paths", () => {
    const policy = createAiFileAccessPolicy("/project", []);

    expect(policy.isDenied("")).toBe(true);
    expect(policy.isDenied(".")).toBe(true);
    expect(policy.isDenied("../secret.md")).toBe(true);
    expect(policy.isDenied("/secret.md")).toBe(true);
  });

  it("throws denial errors that include the blocked path", () => {
    const policy = createAiFileAccessPolicy("/project", ["secrets/key.md"]);

    expect(() => policy.assertReadableByAi("secrets/key.md")).toThrow(
      "Access denied by AI read settings: secrets/key.md",
    );
  });
});
