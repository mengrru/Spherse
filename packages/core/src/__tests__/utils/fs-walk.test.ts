import { describe, expect, it } from "vitest";
import { shouldSkipDirEntry } from "../../utils/fs-walk.js";

describe("shouldSkipDirEntry", () => {
  it("skips dotfiles, node_modules, and .git", () => {
    expect(shouldSkipDirEntry(".git")).toBe(true);
    expect(shouldSkipDirEntry(".spherse")).toBe(true);
    expect(shouldSkipDirEntry(".DS_Store")).toBe(true);
    expect(shouldSkipDirEntry("node_modules")).toBe(true);
  });

  it("does not skip regular directory entries", () => {
    expect(shouldSkipDirEntry("src")).toBe(false);
    expect(shouldSkipDirEntry("lore")).toBe(false);
    expect(shouldSkipDirEntry("AGENTS.md")).toBe(false);
  });
});
