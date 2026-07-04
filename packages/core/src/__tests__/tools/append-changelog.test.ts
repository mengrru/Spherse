import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAppendChangelogTool } from "../../tools/append-changelog.js";
import { ToolContext } from "../../tools/tool-context.js";
import { ProjectStore } from "../../store/project.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import { createSilentLogger } from "../../logger.js";
import { createTempProject, cleanupDir, readFile } from "../helpers.js";

describe("createAppendChangelogTool", () => {
  let projectRoot: string;
  let projectStore: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    projectStore = new ProjectStore(projectRoot, createSilentLogger());
    await projectStore.create("TestProject");
  });

  afterEach(async () => {
    projectStore.close();
    await cleanupDir(projectRoot);
  });

  function makeTool(): ReturnType<typeof createAppendChangelogTool> {
    const ctx = new ToolContext(projectStore, new FileWriteMutex());
    return createAppendChangelogTool(ctx);
  }

  it("appends an entry to CHANGELOG.md", async () => {
    const tool = makeTool();
    const result = await tool.execute(
      "tc1",
      { agent: "writer", action: "create", target: "chapter1.md", description: "Created chapter 1" },
      undefined as any,
    );
    expect(result.content[0].text).toContain("Changelog entry appended");
    expect(result.details?.agent).toBe("writer");
    const content = await readFile(projectRoot, "CHANGELOG.md");
    expect(content).toContain("writer / create / `chapter1.md`");
    expect(content).toContain("Created chapter 1");
  });

  it("appends multiple entries in order", async () => {
    const tool = makeTool();
    await tool.execute(
      "tc1",
      { agent: "a", action: "create", target: "x", description: "first" },
      undefined as any,
    );
    await tool.execute(
      "tc1",
      { agent: "b", action: "update", target: "y", description: "second" },
      undefined as any,
    );
    const content = await readFile(projectRoot, "CHANGELOG.md");
    const firstIdx = content.indexOf("first");
    const secondIdx = content.indexOf("second");
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});
