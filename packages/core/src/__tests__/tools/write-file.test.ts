import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createWriteFileTool } from "../../tools/write-file.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import { createTempProject, cleanupDir, readFile, pathExists } from "../helpers.js";

describe("createWriteFileTool", () => {
  let projectRoot: string;
  let mutex: FileWriteMutex;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    mutex = new FileWriteMutex();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("writes a new file", async () => {
    const tool = createWriteFileTool(projectRoot, mutex);
    const result = await tool.execute("tc1", { path: "out.txt", content: "hello" }, undefined as any);
    expect(result.content[0].text).toContain("Successfully wrote");
    expect(result.details).toEqual({ path: "out.txt", size: 5 });
    const content = await readFile(projectRoot, "out.txt");
    expect(content).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    const tool = createWriteFileTool(projectRoot, mutex);
    await tool.execute("tc1", { path: "out.txt", content: "old" }, undefined as any);
    await tool.execute("tc1", { path: "out.txt", content: "new" }, undefined as any);
    const content = await readFile(projectRoot, "out.txt");
    expect(content).toBe("new");
  });

  it("creates parent directories by default", async () => {
    const tool = createWriteFileTool(projectRoot, mutex);
    await tool.execute("tc1", { path: "a/b/c/deep.txt", content: "deep" }, undefined as any);
    expect(await readFile(projectRoot, "a/b/c/deep.txt")).toBe("deep");
  });

  it("skips directory creation when createDirs is false", async () => {
    const tool = createWriteFileTool(projectRoot, mutex);
    await expect(
      tool.execute("tc1", { path: "no/such/dir/file.txt", content: "x", createDirs: false }, undefined as any),
    ).rejects.toThrow();
  });

  it("rejects path traversal", async () => {
    const tool = createWriteFileTool(projectRoot, mutex);
    await expect(
      tool.execute("tc1", { path: "../../escape.txt", content: "nope" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
