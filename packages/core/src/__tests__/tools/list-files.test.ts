import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { llmAccessPolicy } from "../../access/access-policy.js";
import { createListFilesTool } from "../../tools/list-files.js";
import { createTempProject, cleanupDir, writeFile, ensureDir, permissivePolicy } from "../helpers.js";

describe("createListFilesTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("lists files and directories flat", async () => {
    await writeFile(projectRoot, "a.txt", "a");
    await writeFile(projectRoot, "b.md", "b");
    await ensureDir(projectRoot, "subdir");
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "." }, undefined as any);
    const text = result.content[0].text;
    expect(text).toContain("📄 a.txt");
    expect(text).toContain("📄 b.md");
    expect(text).toContain("📁 subdir");
    expect(result.details).toMatchObject({ path: ".", recursive: false, count: 3 });
  });

  it("lists recursively", async () => {
    await writeFile(projectRoot, "top.txt", "top");
    await writeFile(projectRoot, "sub/nested.txt", "nested");
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: ".", recursive: true }, undefined as any);
    const text = result.content[0].text;
    expect(text).toContain("📄 top.txt");
    expect(text).toContain("📄 nested.txt");
    expect(result.details?.recursive).toBe(true);
  });

  it("limits recursion depth to 1", async () => {
    await writeFile(projectRoot, "top.txt", "top");
    await writeFile(projectRoot, "a/b/nested.txt", "deep");
    await ensureDir(projectRoot, "a/b/c");
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: ".", recursive: true, depth: 1 }, undefined as any);
    const text = result.content[0].text;
    expect(text).toContain("📄 top.txt");
    expect(text).toContain("📁 a");
    expect(text).not.toContain("nested.txt");
    expect(result.details?.depth).toBe(1);
  });

  it("limits recursion depth to 2", async () => {
    await writeFile(projectRoot, "a/file.txt", "mid");
    await writeFile(projectRoot, "a/b/c/deep.txt", "deep");
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: ".", recursive: true, depth: 2 }, undefined as any);
    const text = result.content[0].text;
    expect(text).toContain("📄 file.txt");
    expect(text).toContain("📁 b");
    expect(text).not.toContain("deep.txt");
  });

  it("ignores depth when recursive is false", async () => {
    await writeFile(projectRoot, "sub/file.txt", "content");
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: ".", recursive: false, depth: 5 }, undefined as any);
    const text = result.content[0].text;
    expect(text).toContain("📁 sub");
    expect(text).not.toContain("file.txt");
  });

  it("recursive true without depth lists all levels", async () => {
    await writeFile(projectRoot, "a/b/c/deep.txt", "deep");
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: ".", recursive: true }, undefined as any);
    expect(result.content[0].text).toContain("deep.txt");
  });

  it("shows (empty directory) for empty dir", async () => {
    await ensureDir(projectRoot, "empty");
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "empty" }, undefined as any);
    expect(result.content[0].text).toBe("(empty directory)");
  });

  it("returns error for non-existent directory", async () => {
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "nope" }, undefined as any);
    expect(result.content[0].text).toContain("Directory not found");
    expect(result.details?.exists).toBe(false);
  });

  it("returns error when path is a file", async () => {
    await writeFile(projectRoot, "file.txt", "hi");
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "file.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Not a directory");
    expect(result.details?.isDirectory).toBe(false);
  });

  it("omits blocked entries and denies listing blocked paths", async () => {
    await ensureDir(projectRoot, "secrets");
    await writeFile(projectRoot, "public.md", "public");
    const policy = () => llmAccessPolicy(projectRoot, ["secrets"]);
    const tool = createListFilesTool(projectRoot, policy);

    const rootResult = await tool.execute("tc1", { path: ".", recursive: false }, undefined as any);
    expect(rootResult.content[0].text).not.toContain("secrets");
    expect(rootResult.content[0].text).toContain("public.md");

    const deniedResult = await tool.execute("tc1", { path: "secrets", recursive: false }, undefined as any);
    expect(deniedResult.content[0].text).toContain("Access denied");
  });

  it("rejects path traversal", async () => {
    const tool = createListFilesTool(projectRoot, permissivePolicy(projectRoot));
    await expect(
      tool.execute("tc1", { path: "../../etc" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
