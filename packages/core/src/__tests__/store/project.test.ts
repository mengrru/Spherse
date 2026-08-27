import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSilentLogger } from "../../logger.js";
import { ProjectStore } from "../../store/project.js";
import { ProjectConfigStore } from "../../store/project-config.js";
import { createTempProject, cleanupDir, readFile, removeFile, pathExists, writeFile } from "../helpers.js";

const VALID_PROFILE = `---
name: World Builder
model: gemini-2.5-pro
tools:
  - read_file
---

You are a world building assistant.`;

describe("ProjectStore — lifecycle", () => {
  let projectRoot: string;
  let store: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    store = new ProjectStore(projectRoot, createSilentLogger());
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("creates a project with all default files", async () => {
    await store.create("TestProject");
    const config = store.config.get();
    expect(config.name).toBe("TestProject");
    expect(pathExists(projectRoot, ".spherse/project.yaml")).toBe(true);
    expect(pathExists(projectRoot, ".spherse/agents")).toBe(true);
    expect(pathExists(projectRoot, "AGENTS.md")).toBe(true);
    expect(pathExists(projectRoot, "CHANGELOG.md")).toBe(true);
  });

  it("opens an existing project", async () => {
    await store.create("MyProject");
    const store2 = new ProjectStore(projectRoot, createSilentLogger());
    await store2.open();
    const config = store2.config.get();
    expect(config.name).toBe("MyProject");
  });

  it("loads project skills from .agents/skills", async () => {
    await store.create("MyProject");
    await writeFile(
      projectRoot,
      ".agents/skills/external/SKILL.md",
      "---\nname: external\ndescription: External skill\n---\nExternal instructions.",
    );

    expect(await store.skill.get("external")).toMatchObject({
      name: "external",
      instructions: "External instructions.",
      source: "project",
    });
  });

  it("throws when opening non-existent project", async () => {
    await expect(store.open()).rejects.toThrow("project.yaml not found");
  });

  it("throws when accessing config before open", () => {
    expect(() => store.config).toThrow("Project is not open");
  });

  it("returns root path", () => {
    expect(store.getRootPath()).toBe(projectRoot);
  });
});

describe("ProjectStore — config delegation", () => {
  let projectRoot: string;
  let store: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    store = new ProjectStore(projectRoot, createSilentLogger());
    await store.create("TestProject");
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("exposes config store", () => {
    expect(store.config).toBeInstanceOf(ProjectConfigStore);
    expect(store.config.getProjectId()).toBeDefined();
  });

  it("reads and updates index", async () => {
    const index = await store.readIndex();
    expect(index).toContain("未命名项目");
    await store.updateIndex("# Updated Index");
    expect(await store.readIndex()).toBe("# Updated Index");
  });

  it("returns empty string when AGENTS.md is missing", async () => {
    await removeFile(projectRoot, "AGENTS.md");
    expect(pathExists(projectRoot, "AGENTS.md")).toBe(false);
    expect(await store.readIndex()).toBe("");
  });

  it("appends changelog entries", async () => {
    await store.appendChangelog({
      agent: "writer",
      action: "create",
      target: "ch1.md",
      description: "Created chapter 1",
    });
    const content = await readFile(projectRoot, "CHANGELOG.md");
    expect(content).toContain("writer / create / `ch1.md`");
    expect(content).toContain("Created chapter 1");
  });
});

describe("ProjectStore — agent management", () => {
  let projectRoot: string;
  let store: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    store = new ProjectStore(projectRoot, createSilentLogger());
    await store.create("TestProject");
  });

  afterEach(async () => {
    store.close();
    await cleanupDir(projectRoot);
  });

  it("starts with no agents", () => {
    expect(store.listAgents()).toEqual([]);
    expect(store.agents.size).toBe(0);
  });

  it("creates an agent", async () => {
    const agentStore = await store.createAgent("world-builder", VALID_PROFILE);
    expect(agentStore.getProfile().name).toBe("World Builder");
    expect(store.agents.size).toBe(1);
    expect(store.listAgents()).toHaveLength(1);
  });

  it("lists agents sorted by createdAt descending (newest first)", async () => {
    const profile = (createdAt: number): string =>
      VALID_PROFILE.replace(
        "model: gemini-2.5-pro",
        `model: gemini-2.5-pro\ncreatedAt: ${createdAt}`,
      );

    await store.createAgent("old-agent", profile(1000));
    await store.createAgent("new-agent", profile(3000));
    await store.createAgent("mid-agent", profile(2000));

    const list = store.listAgents();
    expect(list.map((a) => a.createdAt)).toEqual([3000, 2000, 1000]);
  });

  it("gets agent by id", async () => {
    const created = await store.createAgent("world-builder", VALID_PROFILE);
    const id = created.getProfile().id;
    expect(store.getAgent(id)).toBeDefined();
    expect(store.getAgent("nonexistent")).toBeUndefined();
  });

  it("loads agents on open", async () => {
    await store.createAgent("world-builder", VALID_PROFILE);
    await store.createAgent("lore-keeper", VALID_PROFILE.replace("World Builder", "Lore Keeper"));

    const store2 = new ProjectStore(projectRoot, createSilentLogger());
    await store2.open();
    expect(store2.agents.size).toBe(2);
    expect(store2.listAgents()).toHaveLength(2);
  });

  it("deletes an agent", async () => {
    const created = await store.createAgent("world-builder", VALID_PROFILE);
    const id = created.getProfile().id;

    await store.deleteAgent(id);
    expect(store.agents.size).toBe(0);
    expect(store.getAgent(id)).toBeUndefined();
  });

  it("sanitizes unsafe slug input instead of writing outside the agents dir", async () => {
    const created = await store.createAgent("../bad", VALID_PROFILE);
    const slug = created.getProfile().slug;
    expect(slug).toMatch(/^bad-[0-9a-f]{6}$/);
    expect(pathExists(projectRoot, `.spherse/agents/${slug}/profile.md`)).toBe(true);
  });

  it("derives the slug from the profile name when no slug base is given", async () => {
    const created = await store.createAgent(undefined, VALID_PROFILE);
    expect(created.getProfile().slug).toMatch(/^world-builder-[0-9a-f]{6}$/);
  });

  it("avoids slug collisions between agents with the same name", async () => {
    const a = await store.createAgent("world-builder", VALID_PROFILE);
    const b = await store.createAgent("world-builder", VALID_PROFILE);
    expect(a.getProfile().slug).not.toBe(b.getProfile().slug);
  });

  it("rejects profile without name", async () => {
    await expect(
      store.createAgent("bad-agent", "---\ntools:\n  - read_file\n---\ncontent"),
    ).rejects.toThrow("agent profile name is required");
  });
});

describe("ProjectStore — agent sessions and schedules access", () => {
  let projectRoot: string;
  let store: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    store = new ProjectStore(projectRoot, createSilentLogger());
    await store.create("TestProject");
  });

  afterEach(async () => {
    store.close();
    await cleanupDir(projectRoot);
  });

  it("agent store provides sessions and triggers getters", async () => {
    const agentStore = await store.createAgent("world-builder", VALID_PROFILE);

    const sessionId = agentStore.sessions.createSession("Test");
    expect(agentStore.sessions.getSession(sessionId)).not.toBeNull();

    agentStore.triggers.create({
      id: "trig-1",
      enabled: true,
      type: "time",
      cron: "0 9 * * *",
      mode: "new_session",
      message: "hello",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(agentStore.triggers.list()).toHaveLength(1);
  });
});
