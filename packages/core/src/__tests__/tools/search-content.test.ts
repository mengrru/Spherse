import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSearchContentTool } from "../../tools/search-content.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("createSearchContentTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("finds matching lines across files", async () => {
    await writeFile(projectRoot, "a.txt", "hello world\nfoo bar");
    await writeFile(projectRoot, "b.txt", "hello universe");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "hello" }, undefined as any);
    const text = result.content[0].text as string;
    expect(text).toContain("hello world");
    expect(text).toContain("hello universe");
    expect(result.details?.matches).toBe(2);
  });

  it("performs case-insensitive search", async () => {
    await writeFile(projectRoot, "a.txt", "Hello World");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "hello" }, undefined as any);
    expect(result.details?.matches).toBe(1);
  });

  it("searches within a subdirectory", async () => {
    await writeFile(projectRoot, "top.txt", "match here");
    await writeFile(projectRoot, "sub/deep.txt", "match deep");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "match", path: "sub" }, undefined as any);
    expect(result.details?.matches).toBe(1);
    expect(result.content[0].text).toContain("deep.txt");
  });

  it("filters by includePatterns", async () => {
    await writeFile(projectRoot, "doc.md", "search me");
    await writeFile(projectRoot, "data.json", "search me too");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute(
      "tc1",
      { query: "search", includePatterns: ["*.md"] },
      undefined as any,
    );
    expect(result.details?.matches).toBe(1);
    expect(result.content[0].text).toContain("doc.md");
  });

  it("skips dotfiles and node_modules", async () => {
    await writeFile(projectRoot, ".hidden/config", "secret match");
    await writeFile(projectRoot, "node_modules/pkg/index.js", "match in deps");
    await writeFile(projectRoot, "visible.txt", "match visible");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "match" }, undefined as any);
    expect(result.details?.matches).toBe(1);
  });

  it("returns no matches message when nothing found", async () => {
    await writeFile(projectRoot, "a.txt", "nothing relevant");
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "missing" }, undefined as any);
    expect(result.content[0].text).toContain("No matches found");
    expect(result.details?.matches).toBe(0);
  });

  it("caps results at 100", async () => {
    for (let i = 0; i < 110; i++) {
      await writeFile(projectRoot, `file${i}.txt`, `match line`);
    }
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "match" }, undefined as any);
    expect(result.details?.matches).toBe(100);
    expect(result.details?.truncated).toBe(true);
  });

  it("returns error for non-existent path", async () => {
    const tool = createSearchContentTool(projectRoot);
    const result = await tool.execute("tc1", { query: "x", path: "nope" }, undefined as any);
    expect(result.content[0].text).toContain("Path not found");
  });
});
