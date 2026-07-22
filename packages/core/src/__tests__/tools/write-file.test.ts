import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createWriteFileTool } from "../../tools/write-file.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import { createTempProject, cleanupDir, readFile, pathExists, permissivePolicy } from "../helpers.js";

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
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "out.txt", content: "hello" }, undefined as any);
    expect(result.content[0].text).toContain("Successfully wrote");
    expect(result.details).toEqual({ path: "out.txt", size: 5 });
    const content = await readFile(projectRoot, "out.txt");
    expect(content).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    await tool.execute("tc1", { path: "out.txt", content: "old" }, undefined as any);
    await tool.execute("tc1", { path: "out.txt", content: "new" }, undefined as any);
    const content = await readFile(projectRoot, "out.txt");
    expect(content).toBe("new");
  });

  it("creates parent directories by default", async () => {
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    await tool.execute("tc1", { path: "a/b/c/deep.txt", content: "deep" }, undefined as any);
    expect(await readFile(projectRoot, "a/b/c/deep.txt")).toBe("deep");
  });

  it("skips directory creation when createDirs is false", async () => {
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    await expect(
      tool.execute("tc1", { path: "no/such/dir/file.txt", content: "x", createDirs: false }, undefined as any),
    ).rejects.toThrow();
  });

  it("rejects path traversal", async () => {
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    await expect(
      tool.execute("tc1", { path: "../../escape.txt", content: "nope" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });

  it("writes valid JSON to a .json file", async () => {
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "data.json", content: '{"a":1}' }, undefined as any);
    expect(result.content[0].text).toContain("Successfully wrote");
    expect(await readFile(projectRoot, "data.json")).toBe('{"a":1}');
  });

  it("rejects invalid JSON and does not write the file", async () => {
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "bad.json", content: '{"a":1,}' }, undefined as any);
    expect(result.content[0].text).toContain("Invalid JSON");
    expect(result.details).toEqual({ path: "bad.json", jsonError: true });
    expect(pathExists(projectRoot, "bad.json")).toBe(false);
  });

  it("rejects invalid JSON without creating parent directories", async () => {
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "sub/dir/bad.json", content: "{bad}" }, undefined as any);
    expect(result.details).toEqual({ path: "sub/dir/bad.json", jsonError: true });
    expect(pathExists(projectRoot, "sub")).toBe(false);
  });

  it("allows empty content to a .json file", async () => {
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "empty.json", content: "" }, undefined as any);
    expect(result.content[0].text).toContain("Successfully wrote");
    expect(await readFile(projectRoot, "empty.json")).toBe("");
  });

  it("does not validate non-json files", async () => {
    const tool = createWriteFileTool(projectRoot, mutex, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "notes.txt", content: "not json {" }, undefined as any);
    expect(result.content[0].text).toContain("Successfully wrote");
    expect(await readFile(projectRoot, "notes.txt")).toBe("not json {");
  });
});
