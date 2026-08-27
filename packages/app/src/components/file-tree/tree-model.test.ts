import { describe, expect, it } from "vitest";
import { buildTreeItems, childPath, parentDirPath } from "./tree-model";
import type { FileEntry } from "../../lib/types";

describe("buildTreeItems", () => {
  it("filters dotfiles and dotdirs", () => {
    const entries: FileEntry[] = [
      { name: ".hidden", type: "file" },
      { name: ".config", type: "directory" },
      { name: "README.md", type: "file" },
    ];
    const items = buildTreeItems(entries, "");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("README.md");
  });

  it("sorts directories before files, then alphabetically", () => {
    const entries: FileEntry[] = [
      { name: "zebra.md", type: "file" },
      { name: "alpha", type: "directory" },
      { name: "beta.txt", type: "file" },
      { name: "gamma", type: "directory" },
    ];
    const items = buildTreeItems(entries, "");
    expect(items.map((item) => item.name)).toEqual(["alpha", "gamma", "beta.txt", "zebra.md"]);
  });

  it("builds paths with parent prefix", () => {
    const entries: FileEntry[] = [
      { name: "src", type: "directory" },
      { name: "index.ts", type: "file" },
    ];
    const items = buildTreeItems(entries, "project");
    expect(items[0].path).toBe("project/src");
    expect(items[1].path).toBe("project/index.ts");
  });

  it("builds full project-relative paths when rooted at a nested rootPath", () => {
    const entries: FileEntry[] = [
      { name: "foo", type: "directory" },
      { name: "SKILL.md", type: "file" },
    ];
    const items = buildTreeItems(entries, ".spherse/skills");
    expect(items[0].path).toBe(".spherse/skills/foo");
    expect(items[1].path).toBe(".spherse/skills/SKILL.md");
  });

  it("returns empty array for empty input", () => {
    expect(buildTreeItems([], "")).toEqual([]);
  });
});

describe("parentDirPath", () => {
  it("returns empty string for top-level paths", () => {
    expect(parentDirPath("docs")).toBe("");
  });

  it("returns the direct parent for nested paths", () => {
    expect(parentDirPath("src/components/ui")).toBe("src/components");
    expect(parentDirPath(".spherse/skills/demo/SKILL.md")).toBe(".spherse/skills/demo");
  });
});

describe("childPath", () => {
  it("concatenates with separator under a parent", () => {
    expect(childPath("docs", "a.md")).toBe("docs/a.md");
  });

  it("returns the bare name at the project root", () => {
    expect(childPath("", "docs")).toBe("docs");
  });
});
