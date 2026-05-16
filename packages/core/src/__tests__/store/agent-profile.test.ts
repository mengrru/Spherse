import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentProfileStore } from "../../store/agent-profile.js";
import { createTempProject, cleanupDir, writeFile, ensureDir } from "../helpers.js";

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

  it("lists profiles from markdown files", async () => {
    await writeFile(agentDir, "builder.md", VALID_PROFILE);
    const profiles = await store.list();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("World Builder");
    expect(profiles[0].type).toBe("assistant");
    expect(profiles[0].systemPrompt).toContain("world building assistant");
  });

  it("gets profile by id", async () => {
    await writeFile(agentDir, "builder.md", VALID_PROFILE);
    const profiles = await store.list();
    const id = profiles[0].id;
    const profile = await store.getById(id);
    expect(profile!.name).toBe("World Builder");
  });

  it("gets profile by name", async () => {
    await writeFile(agentDir, "builder.md", VALID_PROFILE);
    const profile = await store.getByName("World Builder");
    expect(profile).not.toBeNull();
    expect(profile!.type).toBe("assistant");
  });

  it("returns null for non-existent id/name", async () => {
    expect(await store.getById("nope")).toBeNull();
    expect(await store.getByName("nope")).toBeNull();
  });

  it("saves a new profile", async () => {
    const profile = await store.save("new-agent.md", VALID_PROFILE);
    expect(profile.name).toBe("World Builder");
    expect(profile.id).toBeDefined();
    const profiles = await store.list();
    expect(profiles).toHaveLength(1);
  });

  it("deletes a profile by id", async () => {
    await writeFile(agentDir, "builder.md", VALID_PROFILE);
    const profiles = await store.list();
    await store.delete(profiles[0].id);
    const remaining = await store.list();
    expect(remaining).toHaveLength(0);
  });

  it("skips files without required frontmatter fields", async () => {
    await writeFile(agentDir, "bad.md", "---\nname: NoType\n---\ncontent");
    const profiles = await store.list();
    expect(profiles).toHaveLength(0);
  });

  it("returns empty list for empty directory", async () => {
    const profiles = await store.list();
    expect(profiles).toHaveLength(0);
  });

  it("getRawContent returns raw markdown for existing profile", async () => {
    const profile = await store.save("raw-test.md", VALID_PROFILE);
    const raw = await store.getRawContent(profile.id);
    expect(raw).toContain("name: World Builder");
    expect(raw).toContain("world building assistant");
  });

  it("getRawContent returns null for non-existent id", async () => {
    const raw = await store.getRawContent("nope");
    expect(raw).toBeNull();
  });
});
