import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAiFileAccessPolicy } from "../../access/ai-file-access.js";
import { createReadFileTool } from "../../tools/read-file.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("createReadFileTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("reads an existing file", async () => {
    await writeFile(projectRoot, "hello.txt", "hello world");
    const tool = createReadFileTool(projectRoot);
    const result = await tool.execute("tc1", { path: "hello.txt" }, undefined as any);
    expect(result.content[0].text).toBe("hello world");
    expect(result.details).toEqual({ path: "hello.txt", size: 11 });
  });

  it("reads a nested file", async () => {
    await writeFile(projectRoot, "docs/notes.md", "# Notes");
    const tool = createReadFileTool(projectRoot);
    const result = await tool.execute("tc1", { path: "docs/notes.md" }, undefined as any);
    expect(result.content[0].text).toBe("# Notes");
  });

  it("returns error for non-existent file", async () => {
    const tool = createReadFileTool(projectRoot);
    const result = await tool.execute("tc1", { path: "missing.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Error");
    expect(result.details).toBeUndefined();
  });

  it("denies reading a blocked file and includes the path", async () => {
    await writeFile(projectRoot, "secrets/key.md", "secret");
    const policy = () => createAiFileAccessPolicy(projectRoot, ["secrets/key.md"]);
    const tool = createReadFileTool(projectRoot, policy);

    const result = await tool.execute("tc1", { path: "secrets/key.md" }, undefined as any);

    expect(result.content[0].text).toContain("Access denied by AI read settings: secrets/key.md");
    expect(result.content[0].text).not.toBe("secret");
  });

  it("rejects path traversal with ../", async () => {
    const tool = createReadFileTool(projectRoot);
    await expect(
      tool.execute("tc1", { path: "../../../etc/passwd" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });

  it("rejects path traversal with absolute path outside root", async () => {
    const tool = createReadFileTool(projectRoot);
    await expect(
      tool.execute("tc1", { path: "/etc/passwd" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });
});
