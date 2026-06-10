import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAiFileAccessPolicy } from "../../access/ai-file-access.js";
import { createMoveFileTool } from "../../tools/move-file.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import { createTempProject, cleanupDir, writeFile, readFile, pathExists } from "../helpers.js";

describe("createMoveFileTool", () => {
  let projectRoot: string;
  let mutex: FileWriteMutex;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    mutex = new FileWriteMutex();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("moves a file", async () => {
    await writeFile(projectRoot, "src.txt", "content");
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    const result = await tool.execute("tc1", { source: "src.txt", destination: "dest.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Successfully moved");
    expect(await readFile(projectRoot, "dest.txt")).toBe("content");
    expect(pathExists(projectRoot, "src.txt")).toBe(false);
  });

  it("moves a directory", async () => {
    await writeFile(projectRoot, "dir/file.txt", "content");
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    const result = await tool.execute("tc1", { source: "dir", destination: "dir2" }, undefined as any);
    expect(result.content[0].text).toContain("Successfully moved");
    expect(await readFile(projectRoot, "dir2/file.txt")).toBe("content");
    expect(pathExists(projectRoot, "dir")).toBe(false);
  });

  it("renames a file in the same directory", async () => {
    await writeFile(projectRoot, "old.txt", "data");
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    await tool.execute("tc1", { source: "old.txt", destination: "new.txt" }, undefined as any);
    expect(await readFile(projectRoot, "new.txt")).toBe("data");
    expect(pathExists(projectRoot, "old.txt")).toBe(false);
  });

  it("creates parent directories for destination", async () => {
    await writeFile(projectRoot, "file.txt", "data");
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    await tool.execute("tc1", { source: "file.txt", destination: "a/b/c/file.txt" }, undefined as any);
    expect(await readFile(projectRoot, "a/b/c/file.txt")).toBe("data");
  });

  it("returns error when source does not exist", async () => {
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    const result = await tool.execute("tc1", { source: "nope.txt", destination: "dest.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Source not found");
    expect(result.details?.exists).toBe(false);
  });

  it("returns error when destination already exists", async () => {
    await writeFile(projectRoot, "src.txt", "a");
    await writeFile(projectRoot, "dest.txt", "b");
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    const result = await tool.execute("tc1", { source: "src.txt", destination: "dest.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Destination already exists");
    expect(result.details?.destinationExists).toBe(true);
  });

  it("returns error when source is denied by AI access policy", async () => {
    await writeFile(projectRoot, "secrets/key.txt", "secret");
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, ["secrets"]));
    const result = await tool.execute("tc1", { source: "secrets/key.txt", destination: "public/key.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Access denied");
    expect(result.details?.denied).toBe(true);
  });

  it("returns error when moving a directory into itself", async () => {
    await writeFile(projectRoot, "dir/file.txt", "content");
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    const result = await tool.execute("tc1", { source: "dir", destination: "dir/backup" }, undefined as any);
    expect(result.content[0].text).toContain("Cannot move into itself");
  });

  it("returns error when source and destination are the same", async () => {
    await writeFile(projectRoot, "file.txt", "content");
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    const result = await tool.execute("tc1", { source: "file.txt", destination: "file.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Cannot move into itself");
  });

  it("rejects path traversal on source", async () => {
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    await expect(
      tool.execute("tc1", { source: "../../etc/passwd", destination: "dest.txt" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });

  it("rejects path traversal on destination", async () => {
    await writeFile(projectRoot, "src.txt", "a");
    const tool = createMoveFileTool(projectRoot, mutex, () => createAiFileAccessPolicy(projectRoot, []));
    await expect(
      tool.execute("tc1", { source: "src.txt", destination: "../../escape.txt" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
