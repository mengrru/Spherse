import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { llmAccessPolicy } from "../../access/access-policy.js";
import { createReadFileTool } from "../../tools/read-file.js";
import { createTempProject, cleanupDir, writeFile, permissivePolicy } from "../helpers.js";

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
    const tool = createReadFileTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "hello.txt" }, undefined as any);
    expect(result.content[0].text).toBe("hello world");
    expect(result.details).toEqual({ path: "hello.txt", size: 11 });
  });

  it("reads a nested file", async () => {
    await writeFile(projectRoot, "docs/notes.md", "# Notes");
    const tool = createReadFileTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "docs/notes.md" }, undefined as any);
    expect(result.content[0].text).toBe("# Notes");
  });

  it("returns error for non-existent file", async () => {
    const tool = createReadFileTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { path: "missing.txt" }, undefined as any);
    expect(result.content[0].text).toContain("Error");
    expect(result.details).toBeUndefined();
  });

  it("denies reading a blocked file and includes the path", async () => {
    await writeFile(projectRoot, "secrets/key.md", "secret");
    const policy = () => llmAccessPolicy(projectRoot, ["secrets/key.md"]);
    const tool = createReadFileTool(projectRoot, policy);

    const result = await tool.execute("tc1", { path: "secrets/key.md" }, undefined as any);

    expect(result.content[0].text).toContain("Access denied");
    expect(result.content[0].text).toContain("secrets/key.md");
    expect(result.content[0].text).not.toBe("secret");
  });

  it("rejects path traversal with ../", async () => {
    const tool = createReadFileTool(projectRoot, permissivePolicy(projectRoot));
    await expect(
      tool.execute("tc1", { path: "../../../etc/passwd" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });

  it("rejects path traversal with absolute path outside root", async () => {
    const tool = createReadFileTool(projectRoot, permissivePolicy(projectRoot));
    await expect(
      tool.execute("tc1", { path: "/etc/passwd" }, undefined as any),
    ).rejects.toThrow("Path traversal denied");
  });

  async function writeBinary(relativePath: string, bytes: Buffer): Promise<void> {
    const fullPath = path.join(projectRoot, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, bytes);
  }

  it("refuses binary files and does not return garbled content", async () => {
    const binary = Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0xff, 0xfe, 0xfd]);
    await writeBinary("data/store.db", binary);
    const tool = createReadFileTool(projectRoot, permissivePolicy(projectRoot));

    const result = await tool.execute("tc1", { path: "data/store.db" }, undefined as any);

    expect(result.content[0].text).toContain("binary file");
    expect(result.content[0].text).toContain("data/store.db");
    expect(result.details).toEqual({ path: "data/store.db", binary: true, image: false, size: 10 });
    expect(result.content[0].text).not.toContain("\u0000");
  });

  it("guides LLM to render_card for image files", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    await writeBinary("assets/photo.png", png);
    const tool = createReadFileTool(projectRoot, permissivePolicy(projectRoot));

    const result = await tool.execute("tc1", { path: "assets/photo.png" }, undefined as any);

    expect(result.content[0].text).toContain("image file");
    expect(result.content[0].text).toContain("render_card");
    expect(result.content[0].text).toContain("assets/photo.png");
    expect(result.details).toEqual({ path: "assets/photo.png", binary: true, image: true, size: 10 });
  });

  it("still reads text files that lack null bytes", async () => {
    await writeFile(projectRoot, "code.ts", "export const x = 1;\n");
    const tool = createReadFileTool(projectRoot, permissivePolicy(projectRoot));

    const result = await tool.execute("tc1", { path: "code.ts" }, undefined as any);

    expect(result.content[0].text).toBe("export const x = 1;\n");
    expect(result.details).toEqual({ path: "code.ts", size: 20 });
  });

  it("treats empty file as text", async () => {
    await writeBinary("empty.txt", Buffer.alloc(0));
    const tool = createReadFileTool(projectRoot, permissivePolicy(projectRoot));

    const result = await tool.execute("tc1", { path: "empty.txt" }, undefined as any);

    expect(result.content[0].text).toBe("");
    expect(result.details).toEqual({ path: "empty.txt", size: 0 });
  });
});
