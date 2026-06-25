import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { llmAccessPolicy } from "../../access/access-policy.js";
import { createCopyFileTool } from "../../tools/copy-file.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import { createTempProject, cleanupDir, writeFile, readFile, ensureDir, pathExists, permissivePolicy } from "../helpers.js";

describe("createCopyFileTool", () => {
  let projectRoot: string;
  let mutex: FileWriteMutex;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    mutex = new FileWriteMutex();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("copies a file", async () => {
    await writeFile(projectRoot, "src.txt", "content");
    const tool = createCopyFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { source: "src.txt", destination: "dest.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Successfully copied");
    expect(await readFile(projectRoot, "dest.txt")).toBe("content");
    expect(pathExists(projectRoot, "src.txt")).toBe(true);
  });

  it("creates parent directories for destination", async () => {
    await writeFile(projectRoot, "file.txt", "data");
    const tool = createCopyFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    await tool.execute("tc1", { source: "file.txt", destination: "a/b/c/file.txt" }, undefined as any);
    expect(await readFile(projectRoot, "a/b/c/file.txt")).toBe("data");
  });

  it("returns error when source does not exist", async () => {
    const tool = createCopyFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { source: "nope.txt", destination: "dest.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Source not found");
    expect(result.details?.exists).toBe(false);
  });

  it("returns error when source is a directory", async () => {
    await ensureDir(projectRoot, "mydir");
    const tool = createCopyFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { source: "mydir", destination: "mydir2" }, undefined as any);
    expect(result.content[0].text).toContain("Source is a directory");
    expect(result.details?.isDirectory).toBe(true);
  });

  it("returns error when destination already exists", async () => {
    await writeFile(projectRoot, "src.txt", "a");
    await writeFile(projectRoot, "dest.txt", "b");
    const tool = createCopyFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { source: "src.txt", destination: "dest.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Destination already exists");
    expect(result.details?.destinationExists).toBe(true);
  });

  it("returns error when source is denied by access policy", async () => {
    await writeFile(projectRoot, "secrets/key.txt", "secret");
    const tool = createCopyFileTool(projectRoot, mutex, () => llmAccessPolicy(projectRoot, ["secrets"]));
    const result = await tool.execute("tc1", { source: "secrets/key.txt", destination: "public/key.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Access denied");
    expect(result.details?.denied).toBe(true);
  });

  it("rejects path traversal on source", async () => {
    const tool = createCopyFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    await expect(
      tool.execute("tc1", { source: "../../etc/passwd", destination: "dest.txt" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });

  it("rejects path traversal on destination", async () => {
    await writeFile(projectRoot, "src.txt", "a");
    const tool = createCopyFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    await expect(
      tool.execute("tc1", { source: "src.txt", destination: "../../escape.txt" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
