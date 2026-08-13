import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { AgentProfileStore, assertSafeSlug } from "../../store/agent-profile.js";
import { createTempProject, cleanupDir, ensureDir, pathExists, writeFile } from "../helpers.js";

describe("AgentProfileStore", () => {
  let agentDir: string;
  let store: AgentProfileStore;
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await createTempProject();
    agentDir = path.join(tmpRoot, "agents", "test-agent-a1b2c3");
    await ensureDir(tmpRoot, "agents/test-agent-a1b2c3");
    store = new AgentProfileStore(
      path.join(agentDir, "profile.md"),
      "test-agent-a1b2c3",
    );
  });

  afterEach(async () => {
    await cleanupDir(tmpRoot);
  });

  const VALID_PROFILE = `---
name: World Builder
type: assistant
model: gemini-2.5-pro
tools:
  - read_file
  - write_file
---

You are a world building assistant.`;

  async function writeProfile(content: string): Promise<void> {
    await writeFile(agentDir, "profile.md", content);
  }

  it("reads a valid profile", async () => {
    await writeProfile(VALID_PROFILE);
    const profile = await store.read();
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("World Builder");
    expect(profile!.systemPrompt).toContain("world building assistant");
    expect(profile!.slug).toBe("test-agent-a1b2c3");
  });

  it("parses alias from frontmatter when present", async () => {
    const content = "---\nname: World Builder\nalias: 小明\n---\n\nprompt";
    await writeProfile(content);
    const profile = await store.read();
    expect(profile).not.toBeNull();
    expect(profile!.alias).toBe("小明");
  });

  it("returns undefined alias when frontmatter omits it", async () => {
    await writeProfile(VALID_PROFILE);
    const profile = await store.read();
    expect(profile).not.toBeNull();
    expect(profile!.alias).toBeUndefined();
  });

  it("parses yolo true from frontmatter", async () => {
    await writeProfile("---\nname: Agent\nyolo: true\n---\n\nprompt");
    const profile = await store.read();
    expect(profile).not.toBeNull();
    expect(profile!.yolo).toBe(true);
  });

  it("returns undefined yolo when frontmatter omits it", async () => {
    await writeProfile(VALID_PROFILE);
    const profile = await store.read();
    expect(profile).not.toBeNull();
    expect(profile!.yolo).toBeUndefined();
  });

  it("returns null when profile.md does not exist", async () => {
    const profile = await store.read();
    expect(profile).toBeNull();
  });

  it("returns null when frontmatter missing name", async () => {
    await writeProfile("---\ntools:\n  - read_file\n---\ncontent");
    const profile = await store.read();
    expect(profile).toBeNull();
  });

  it("generates id if missing on read", async () => {
    await writeProfile("---\nname: No ID\n---\nprompt");
    const profile = await store.read();
    expect(profile).not.toBeNull();
    expect(profile!.id).toBeDefined();

    const raw = await store.getRawContent();
    expect(raw).toContain(`id: ${profile!.id}`);
  });

  it("saves a new profile", async () => {
    const profile = await store.save(VALID_PROFILE);
    expect(profile.name).toBe("World Builder");
    expect(profile.id).toBeDefined();
    expect(profile.filePath).toContain("profile.md");
    expect(pathExists(agentDir, "profile.md")).toBe(true);
  });

  it("rejects saving without required frontmatter", async () => {
    await expect(
      store.save("---\ntools:\n  - read_file\n---\ncontent"),
    ).rejects.toThrow("agent profile name is required");
  });

  it("updates existing profile preserving id and createdAt", async () => {
    const created = await store.save(VALID_PROFILE);

    const updatedContent = VALID_PROFILE.replace(
      "world building assistant",
      "updated assistant",
    );
    const updated = await store.save(updatedContent);

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.systemPrompt).toContain("updated assistant");
  });

  it("preserves id when content tries to change it", async () => {
    const created = await store.save(VALID_PROFILE);
    const updatedContent = VALID_PROFILE.replace(
      "---\n",
      `---\nid: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\n`,
    );
    const updated = await store.save(updatedContent);
    expect(updated.id).toBe(created.id);
  });

  it("getRawContent returns raw markdown", async () => {
    await store.save(VALID_PROFILE);
    const raw = await store.getRawContent();
    expect(raw).toContain("name: World Builder");
    expect(raw).toContain("world building assistant");
  });

  it("getTheme returns empty string when theme.css does not exist", async () => {
    await store.save(VALID_PROFILE);
    const theme = await store.getTheme();
    expect(theme).toBe("");
  });

  it("saveTheme writes and overwrites theme.css", async () => {
    await store.save(VALID_PROFILE);
    await store.saveTheme(":root { --test: red; }");
    expect(await store.getTheme()).toBe(":root { --test: red; }");

    await store.saveTheme(":root { --test: blue; }");
    expect(await store.getTheme()).toBe(":root { --test: blue; }");
    expect(pathExists(agentDir, "theme.css")).toBe(true);
  });
});

describe("assertSafeSlug", () => {
  it("accepts valid slugs", () => {
    expect(() => assertSafeSlug("world-builder")).not.toThrow();
    expect(() => assertSafeSlug("agent_123")).not.toThrow();
  });

  it("rejects empty slugs", () => {
    expect(() => assertSafeSlug("")).toThrow("invalid agent slug");
    expect(() => assertSafeSlug("  ")).toThrow("invalid agent slug");
  });

  it("rejects path traversal", () => {
    expect(() => assertSafeSlug("../bad")).toThrow("invalid agent slug");
    expect(() => assertSafeSlug("a/b")).toThrow("invalid agent slug");
    expect(() => assertSafeSlug("a\\b")).toThrow("invalid agent slug");
  });
});
