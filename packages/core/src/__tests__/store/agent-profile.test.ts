import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { AgentProfileStore } from "../../store/agent-profile.js";
import { createTempProject, cleanupDir, ensureDir, pathExists } from "../helpers.js";

describe("AgentProfileStore", () => {
  let agentDir: string;
  let store: AgentProfileStore;
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await createTempProject();
    agentDir = tmpRoot + "/agents";
    await ensureDir(tmpRoot, "agents");
    store = new AgentProfileStore(agentDir);
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

  async function createAgentDir(
    dir: string,
    slug: string,
    content: string,
  ): Promise<void> {
    const agentPath = path.join(dir, slug);
    await fs.mkdir(agentPath, { recursive: true });
    await fs.writeFile(path.join(agentPath, "profile.md"), content, "utf-8");
  }

  it("lists profiles from agent directories", async () => {
    await createAgentDir(agentDir, "world-builder-a1b2c3", VALID_PROFILE);
    const profiles = await store.list();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("World Builder");
    expect(profiles[0].systemPrompt).toContain("world building assistant");
    expect(profiles[0].slug).toBe("world-builder-a1b2c3");
  });

  it("gets profile by id", async () => {
    await createAgentDir(agentDir, "world-builder-a1b2c3", VALID_PROFILE);
    const profiles = await store.list();
    const id = profiles[0].id;
    const profile = await store.getById(id);
    expect(profile!.name).toBe("World Builder");
  });

  it("gets profile by name", async () => {
    await createAgentDir(agentDir, "world-builder-a1b2c3", VALID_PROFILE);
    const profile = await store.getByName("World Builder");
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("World Builder");
  });

  it("returns null for non-existent id/name", async () => {
    expect(await store.getById("nope")).toBeNull();
    expect(await store.getByName("nope")).toBeNull();
  });

  it("saves a new profile as directory with profile.md", async () => {
    const before = Date.now();
    const profile = await store.save("world-builder", VALID_PROFILE);
    const after = Date.now();

    expect(profile.name).toBe("World Builder");
    expect(profile.id).toBeDefined();
    expect(profile.createdAt).toBeGreaterThanOrEqual(before);
    expect(profile.createdAt).toBeLessThanOrEqual(after);
    expect(profile.slug).toMatch(/^world-builder-[a-f0-9]{6}$/);
    expect(profile.filePath).toContain("profile.md");

    expect(pathExists(agentDir, profile.slug)).toBe(true);
    expect(pathExists(agentDir, `${profile.slug}/profile.md`)).toBe(true);

    const profiles = await store.list();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].createdAt).toBe(profile.createdAt);
  });

  it("deletes a profile by id and removes directory", async () => {
    await createAgentDir(agentDir, "world-builder-a1b2c3", VALID_PROFILE);
    const profiles = await store.list();
    await store.delete(profiles[0].id);
    const remaining = await store.list();
    expect(remaining).toHaveLength(0);
    expect(pathExists(agentDir, "world-builder-a1b2c3")).toBe(false);
  });

  it("skips directories without profile.md", async () => {
    await fs.mkdir(path.join(agentDir, "empty-dir"), { recursive: true });
    const profiles = await store.list();
    expect(profiles).toHaveLength(0);
  });

  it("skips profile.md without required frontmatter fields", async () => {
    await createAgentDir(agentDir, "bad-agent-123456", "---\ntools:\n  - read_file\n---\ncontent");
    const profiles = await store.list();
    expect(profiles).toHaveLength(0);
  });

  it("returns empty list for empty directory", async () => {
    const profiles = await store.list();
    expect(profiles).toHaveLength(0);
  });

  it("getRawContent returns raw markdown for existing profile", async () => {
    const profile = await store.save("raw-test", VALID_PROFILE);
    const raw = await store.getRawContent(profile.id);
    expect(raw).toContain("name: World Builder");
    expect(raw).toContain("world building assistant");
  });

  it("getRawContent returns null for non-existent id", async () => {
    const raw = await store.getRawContent("nope");
    expect(raw).toBeNull();
  });

  it("update existing profile preserves directory", async () => {
    const created = await store.save("world-builder", VALID_PROFILE);
    const originalSlug = created.slug;

    const rawContent = await store.getRawContent(created.id);
    const updatedContent = rawContent!.replace(
      "world building assistant",
      "updated assistant",
    );
    const updated = await store.save(originalSlug, updatedContent);

    expect(updated.slug).toBe(originalSlug);
    expect(updated.systemPrompt).toContain("updated assistant");
    expect(pathExists(agentDir, originalSlug)).toBe(true);
  });

  it("update existing profile preserves id when content id changes", async () => {
    const created = await store.save("world-builder", VALID_PROFILE);
    const rawContent = await store.getRawContent(created.id);
    const updatedContent = rawContent!.replace(
      created.id,
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );

    const updated = await store.save(created.slug, updatedContent);
    const profiles = await store.list();

    expect(updated.id).toBe(created.id);
    expect(updated.slug).toBe(created.slug);
    expect(profiles).toHaveLength(1);
    expect(pathExists(agentDir, created.slug)).toBe(true);
  });

  it("update existing profile preserves createdAt when content changes it", async () => {
    const created = await store.save("world-builder", VALID_PROFILE);
    const rawContent = await store.getRawContent(created.id);
    const updatedContent = rawContent!.replace(
      `createdAt: ${created.createdAt}`,
      "createdAt: 1",
    );

    const updated = await store.save(created.slug, updatedContent);
    const rawUpdated = await store.getRawContent(created.id);

    expect(updated.createdAt).toBe(created.createdAt);
    expect(rawUpdated).toContain(`createdAt: ${created.createdAt}`);
  });

  it("rejects creating an agent with a colliding short id", async () => {
    await createAgentDir(
      agentDir,
      "world-builder-111111",
      VALID_PROFILE.replace(
        "---\n",
        "---\nid: 11111100-0000-4000-8000-000000000000\n",
      ),
    );
    const collidingProfile = VALID_PROFILE.replace(
      "---\n",
      "---\nid: 111111aa-0000-4000-8000-000000000000\n",
    );

    await expect(store.save("world-builder", collidingProfile)).rejects.toThrow(
      "agent slug collision",
    );
    const profiles = await store.list();

    expect(profiles).toHaveLength(1);
    expect(pathExists(agentDir, "world-builder-111111")).toBe(true);
  });

  it("rejects saving profile without required frontmatter", async () => {
    await expect(
      store.save("bad-agent", "---\ntools:\n  - read_file\n---\ncontent"),
    ).rejects.toThrow("agent profile name is required");

    expect(pathExists(agentDir, "bad-agent")).toBe(false);
  });

  it("getTheme returns empty string when theme.css does not exist", async () => {
    const profile = await store.save("theme-test", VALID_PROFILE);
    const theme = await store.getTheme(profile.id);
    expect(theme).toBe("");
  });

  it("saveTheme writes theme.css to agent directory", async () => {
    const profile = await store.save("theme-test", VALID_PROFILE);
    await store.saveTheme(profile.id, ":root { --test: red; }");
    const theme = await store.getTheme(profile.id);
    expect(theme).toBe(":root { --test: red; }");
    expect(pathExists(agentDir, `${profile.slug}/theme.css`)).toBe(true);
  });

  it("saveTheme overwrites existing theme.css", async () => {
    const profile = await store.save("theme-test", VALID_PROFILE);
    await store.saveTheme(profile.id, "first");
    await store.saveTheme(profile.id, "second");
    const theme = await store.getTheme(profile.id);
    expect(theme).toBe("second");
  });

  it("getTheme returns empty string for non-existent agent", async () => {
    const theme = await store.getTheme("nope");
    expect(theme).toBe("");
  });

  it("rejects unsafe slugs", async () => {
    await expect(store.save("../bad", VALID_PROFILE)).rejects.toThrow(
      "invalid agent slug",
    );
    await expect(store.save("", VALID_PROFILE)).rejects.toThrow(
      "invalid agent slug",
    );

    expect(pathExists(tmpRoot, "bad")).toBe(false);
  });
});
