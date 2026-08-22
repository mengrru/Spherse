import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../lib/api";
import {
  fetchProjectDirectory,
  invalidateProjectFileQueries,
} from "./content";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";

describe("content queries", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it("deduplicates directory requests by project and path", async () => {
    const listContent = vi.fn().mockResolvedValue([]);
    const client = { listContent } as unknown as ApiClient;

    await Promise.all([
      fetchProjectDirectory("project-1", client, "docs"),
      fetchProjectDirectory("project-1", client, "docs"),
    ]);

    expect(listContent).toHaveBeenCalledTimes(1);
  });

  it("invalidates the changed content and project file indexes", async () => {
    queryClient.setQueryData(projectQueryKeys.content("project-1", "docs/a.md"), {
      path: "docs/a.md",
      content: "old",
    });
    queryClient.setQueryData(projectQueryKeys.directory("project-1", "docs"), []);
    queryClient.setQueryData(projectQueryKeys.fileTree("project-1"), ["docs/a.md"]);

    invalidateProjectFileQueries("project-1", "docs\\a.md");
    await Promise.resolve();

    expect(queryClient.getQueryState(projectQueryKeys.content("project-1", "docs/a.md"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectQueryKeys.directory("project-1", "docs"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectQueryKeys.fileTree("project-1"))?.isInvalidated).toBe(true);
  });

  it("keeps caches isolated between projects", async () => {
    queryClient.setQueryData(projectQueryKeys.fileTree("project-1"), ["a.md"]);
    queryClient.setQueryData(projectQueryKeys.fileTree("project-2"), ["b.md"]);

    invalidateProjectFileQueries("project-1");
    await Promise.resolve();

    expect(queryClient.getQueryState(projectQueryKeys.fileTree("project-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectQueryKeys.fileTree("project-2"))?.isInvalidated).toBe(false);
  });
});
