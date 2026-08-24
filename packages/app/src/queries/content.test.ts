import { beforeEach, describe, expect, it } from "vitest";
import { contentKeyMatchesChangedPath, invalidateProjectFileQueries } from "./content";
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

    await invalidateProjectFileQueries(projectId, ".spherse/skills/demo");

    expect(queryClient.getQueryState(projectQueryKeys.content(projectId, ".spherse/skills/demo/SKILL.md"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectQueryKeys.content(projectId, "notes/other.md"))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(projectQueryKeys.fileTree(projectId))?.isInvalidated).toBe(true);
  });
});
