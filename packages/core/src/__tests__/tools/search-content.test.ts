import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { llmAccessPolicy } from "../../access/access-policy.js";
import { createSearchContentTool } from "../../tools/search-content.js";
import { createTempProject, cleanupDir, writeFile, permissivePolicy } from "../helpers.js";

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
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { query: "hello" }, undefined as any);
    const text = result.content[0].text as string;
    expect(text).toContain("hello world");
    expect(text).toContain("hello universe");
    expect(result.details?.matches).toBe(2);
  });

  it("performs case-insensitive search", async () => {
    await writeFile(projectRoot, "a.txt", "Hello World");
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { query: "hello" }, undefined as any);
    expect(result.details?.matches).toBe(1);
  });

  it("searches within a subdirectory", async () => {
    await writeFile(projectRoot, "top.txt", "match here");
    await writeFile(projectRoot, "sub/deep.txt", "match deep");
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { query: "match", path: "sub" }, undefined as any);
    expect(result.details?.matches).toBe(1);
    expect(result.content[0].text).toContain("deep.txt");
  });

  it("filters by includePatterns", async () => {
    await writeFile(projectRoot, "doc.md", "search me");
    await writeFile(projectRoot, "data.json", "search me too");
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
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
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { query: "match" }, undefined as any);
    expect(result.details?.matches).toBe(1);
  });

  it("returns no matches message when nothing found", async () => {
    await writeFile(projectRoot, "a.txt", "nothing relevant");
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { query: "missing" }, undefined as any);
    expect(result.content[0].text).toContain("No matches found");
    expect(result.details?.matches).toBe(0);
  });

  it("caps results at 100", async () => {
    for (let i = 0; i < 110; i++) {
      await writeFile(projectRoot, `file${i}.txt`, `match line`);
    }
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { query: "match" }, undefined as any);
    expect(result.details?.matches).toBe(100);
    expect(result.details?.truncated).toBe(true);
  });

  it("returns error for non-existent path", async () => {
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { query: "x", path: "nope" }, undefined as any);
    expect(result.content[0].text).toContain("Path not found");
  });

  it("skips blocked files and denies blocked search roots", async () => {
    await writeFile(projectRoot, "secrets/key.md", "needle secret");
    await writeFile(projectRoot, "public.md", "needle public");
    const policy = () => llmAccessPolicy(projectRoot, ["secrets"]);
    const tool = createSearchContentTool(projectRoot, policy);

    const result = await tool.execute("tc1", { query: "needle" }, undefined as any);
    expect(result.content[0].text).toContain("public.md");
    expect(result.content[0].text).not.toContain("secrets/key.md");
    expect(result.content[0].text).not.toContain("needle secret");

    const deniedResult = await tool.execute("tc1", { query: "needle", path: "secrets" }, undefined as any);
    expect(deniedResult.content[0].text).toContain("Access denied");
  });

  it("searches .spherse files but hides sessions.db (agentSessions unreadable)", async () => {
    await writeFile(projectRoot, ".spherse/agents/bot-abc/sessions.db-wal", "needle in wal");
    await writeFile(projectRoot, ".spherse/agents/bot-abc/sessions.db-shm", "needle in shm");
    await writeFile(projectRoot, ".spherse/agents/bot-abc/sessions.db", "needle in db");
    await writeFile(projectRoot, ".spherse/agents/bot-abc/profile.md", "needle in profile");
    await writeFile(projectRoot, ".spherse/theme.css", "needle in theme");
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));

    const result = await tool.execute("tc1", { query: "needle", path: ".spherse", include_meta: true }, undefined as any);
    const text = result.content[0].text as string;
    expect(text).not.toContain("in db");
    expect(text).toContain("needle in profile");
    expect(text).toContain("needle in theme");
  });

  it("excludes .spherse from search by default (include_meta=false)", async () => {
    await writeFile(projectRoot, ".spherse/theme.css", "needle in theme");
    await writeFile(projectRoot, "notes.txt", "needle in notes");
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));

    const result = await tool.execute("tc1", { query: "needle" }, undefined as any);
    const text = result.content[0].text as string;
    expect(text).not.toContain("theme.css");
    expect(text).toContain("needle in notes");
  });

  it("denies searching .spherse directly without include_meta", async () => {
    await writeFile(projectRoot, ".spherse/theme.css", "needle");
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));

    const result = await tool.execute("tc1", { query: "needle", path: ".spherse" }, undefined as any);
    expect(result.details?.denied).toBe(true);
    expect(result.content[0].text).toContain("include_meta");
  });

  it("denies searching .spherse subdirectories without include_meta", async () => {
    await writeFile(projectRoot, ".spherse/agents/bot/profile.md", "needle");
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));

    const result = await tool.execute("tc1", { query: "needle", path: ".spherse/agents" }, undefined as any);
    expect(result.details?.denied).toBe(true);
    expect(result.content[0].text).toContain("include_meta");
  });

  it("searches .spherse recursively from root when include_meta=true", async () => {
    await writeFile(projectRoot, ".spherse/agents/bot/profile.md", "needle in profile");
    await writeFile(projectRoot, "notes.txt", "needle in notes");
    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));

    const result = await tool.execute("tc1", { query: "needle", include_meta: true }, undefined as any);
    const text = result.content[0].text as string;
    expect(text).toContain("needle in profile");
    expect(text).toContain("needle in notes");
  });

  it("skips binary files and does not return garbled matches", async () => {
    const binary = Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0xff, 0xfe, 0xfd]);
    const binPath = path.join(projectRoot, "data/store.db");
    await fs.mkdir(path.dirname(binPath), { recursive: true });
    await fs.writeFile(binPath, binary);

    await writeFile(projectRoot, "notes.txt", "needle in text");

    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { query: "needle" }, undefined as any);
    const text = result.content[0].text as string;

    expect(text).toContain("notes.txt");
    expect(text).not.toContain("store.db");
    expect(result.details?.matches).toBe(1);
  });

  it("skips binary images that happen to match the query as bytes", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65]);
    await writeFile(projectRoot, "img.txt", "needle text");
    const imgPath = path.join(projectRoot, "assets/photo.png");
    await fs.mkdir(path.dirname(imgPath), { recursive: true });
    await fs.writeFile(imgPath, png);

    const tool = createSearchContentTool(projectRoot, permissivePolicy(projectRoot));
    const result = await tool.execute("tc1", { query: "needle" }, undefined as any);

    expect(result.details?.matches).toBe(1);
    expect(result.content[0].text as string).toContain("img.txt");
    expect(result.content[0].text as string).not.toContain("photo.png");
  });
});
