import { beforeEach, describe, expect, it } from "vitest";
import {
  contentKeyMatchesChangedPath,
  directoryKeyMatchesChangedPath,
  invalidateProjectFileQueries,
} from "./content";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";

describe("contentKeyMatchesChangedPath", () => {
  const projectId = "p1";

  it("matches the exact file path", () => {
    const key = projectQueryKeys.content(projectId, ".spherse/skills/demo/SKILL.md");
    expect(contentKeyMatchesChangedPath(key, projectId, ".spherse/skills/demo/SKILL.md")).toBe(true);
  });

  it("matches content queries for files inside a changed directory", () => {
    const key = projectQueryKeys.content(projectId, ".spherse/skills/demo/SKILL.md");
    expect(contentKeyMatchesChangedPath(key, projectId, ".spherse/skills/demo")).toBe(true);
    expect(contentKeyMatchesChangedPath(key, projectId, ".spherse/skills")).toBe(true);
  });

  it("does not match sibling paths sharing a string prefix", () => {
    const key = projectQueryKeys.content(projectId, ".spherse/skills/demo-extra/SKILL.md");
    expect(contentKeyMatchesChangedPath(key, projectId, ".spherse/skills/demo")).toBe(false);
  });

  it("ignores keys of other projects or other query domains", () => {
    expect(contentKeyMatchesChangedPath(["projects", "p2", "content", "a.md"], projectId, "a.md")).toBe(false);
    expect(contentKeyMatchesChangedPath(["projects", projectId, "skills"], projectId, "a.md")).toBe(false);
    expect(contentKeyMatchesChangedPath(["projects", projectId, "content"], projectId, "a.md")).toBe(false);
    expect(contentKeyMatchesChangedPath(["projects", projectId, "content", 7], projectId, "a.md")).toBe(false);
  });
});

describe("directoryKeyMatchesChangedPath", () => {
  const projectId = "p1";

  it("matches the changed directory itself", () => {
    const key = projectQueryKeys.directory(projectId, "docs");
    expect(directoryKeyMatchesChangedPath(key, projectId, "docs")).toBe(true);
  });

  it("matches the direct parent of the changed path", () => {
    const key = projectQueryKeys.directory(projectId, "src/components");
    expect(directoryKeyMatchesChangedPath(key, projectId, "src/components/Button.tsx")).toBe(true);
  });

  it("matches the project root as parent of a top-level path", () => {
    const key = projectQueryKeys.directory(projectId, "");
    expect(directoryKeyMatchesChangedPath(key, projectId, "README.md")).toBe(true);
  });

  it("matches descendant directories of a removed directory", () => {
    const key = projectQueryKeys.directory(projectId, "docs/guide/assets");
    expect(directoryKeyMatchesChangedPath(key, projectId, "docs/guide")).toBe(true);
  });

  it("does not match sibling directories sharing a string prefix", () => {
    const key = projectQueryKeys.directory(projectId, "docs-extra");
    expect(directoryKeyMatchesChangedPath(key, projectId, "docs")).toBe(false);
  });

  it("does not match deeper ancestors than the direct parent", () => {
    const key = projectQueryKeys.directory(projectId, "src");
    expect(directoryKeyMatchesChangedPath(key, projectId, "src/components/ui")).toBe(false);
  });

  it("ignores keys of other projects or other query domains", () => {
    expect(
      directoryKeyMatchesChangedPath(["projects", "p2", "directories", "docs"], projectId, "docs"),
    ).toBe(false);
    expect(
      directoryKeyMatchesChangedPath(["projects", projectId, "content", "docs"], projectId, "docs"),
    ).toBe(false);
    expect(
      directoryKeyMatchesChangedPath(["projects", projectId, "directories", 7], projectId, "docs"),
    ).toBe(false);
  });
});

describe("invalidateProjectFileQueries with a directory path", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it("invalidates open file content queries under the replaced directory", async () => {
    const projectId = "p1";
    const staleData = { path: ".spherse/skills/demo/SKILL.md", content: "version: 0.1.0", binary: false };
    queryClient.setQueryData(projectQueryKeys.content(projectId, ".spherse/skills/demo/SKILL.md"), staleData);
    queryClient.setQueryData(projectQueryKeys.content(projectId, "notes/other.md"), {
      path: "notes/other.md",
      content: "keep",
      binary: false,
    });
    queryClient.setQueryData(projectQueryKeys.fileTree(projectId), { entries: [] });
    queryClient.setQueryData(projectQueryKeys.directory(projectId, ".spherse/skills"), [{ name: "demo", type: "directory" }]);
    queryClient.setQueryData(projectQueryKeys.directory(projectId, ".spherse/skills/demo"), [{ name: "SKILL.md", type: "file" }]);
    queryClient.setQueryData(projectQueryKeys.directory(projectId, ".spherse/skills/other"), []);

    await invalidateProjectFileQueries(projectId, ".spherse/skills/demo");

    expect(queryClient.getQueryState(projectQueryKeys.content(projectId, ".spherse/skills/demo/SKILL.md"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectQueryKeys.content(projectId, "notes/other.md"))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(projectQueryKeys.fileTree(projectId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectQueryKeys.directory(projectId, ".spherse/skills"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectQueryKeys.directory(projectId, ".spherse/skills/demo"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectQueryKeys.directory(projectId, ".spherse/skills/other"))?.isInvalidated).toBe(false);
  });
});
