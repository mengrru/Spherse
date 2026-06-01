import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAppendChangelogTool } from "../../tools/append-changelog.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import { createTempProject, cleanupDir, writeFile, readFile, pathExists } from "../helpers.js";

describe("createAppendChangelogTool", () => {
  let projectRoot: string;
  let mutex: FileWriteMutex;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    mutex = new FileWriteMutex();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("appends an entry to CHANGELOG.md", async () => {
    const tool = createAppendChangelogTool(projectRoot, undefined, mutex);
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
    const tool = createAppendChangelogTool(projectRoot, undefined, mutex);
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

  it("creates parent directories if needed", async () => {
    const tool = createAppendChangelogTool(projectRoot, "logs/CHANGELOG.md", mutex);
    await tool.execute(
      "tc1",
      { agent: "a", action: "create", target: "x", description: "test" },
      undefined as any,
    );
    expect(pathExists(projectRoot, "logs/CHANGELOG.md")).toBe(true);
  });

  it("rejects path traversal on custom changelog path", async () => {
    const tool = createAppendChangelogTool(projectRoot, "../../etc/evil.md", mutex);
    await expect(
      tool.execute(
        "tc1",
        { agent: "a", action: "x", target: "x", description: "x" },
        undefined as any,
      ),
    ).rejects.toThrow("Path traversal denied");
  });
});
