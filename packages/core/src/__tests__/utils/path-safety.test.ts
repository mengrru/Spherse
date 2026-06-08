import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertInsideProject,
  isPathInside,
  resolveProjectPath,
} from "../../utils/path-safety.js";

describe("path-safety", () => {
  it("allows the project root and descendants", () => {
    const root = path.resolve("/tmp/spherse-project");

    expect(isPathInside(root, root)).toBe(true);
    expect(isPathInside(root, path.join(root, "notes", "a.md"))).toBe(true);
  });

  it("rejects sibling paths that only share a string prefix", () => {
    const root = path.resolve("/tmp/spherse-project");
    const sibling = path.resolve("/tmp/spherse-project-bak/secret.md");

    expect(isPathInside(root, sibling)).toBe(false);
    expect(() => assertInsideProject(root, sibling, "secret.md")).toThrow(
      "Path traversal denied: secret.md",
    );
  });

  it("resolves relative paths and rejects traversal outside the project", () => {
    const root = path.resolve("/tmp/spherse-project");

    expect(resolveProjectPath(root, "docs/guide.md")).toBe(
      path.join(root, "docs", "guide.md"),
    );
    expect(() => resolveProjectPath(root, "../outside.md")).toThrow(
      "Path traversal denied: ../outside.md",
    );
  });
});
