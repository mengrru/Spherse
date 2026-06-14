import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pino from "pino";
import { ProjectStore } from "../../store/project.js";
import { ProjectConfigStore } from "../../store/project-config.js";
import { createTempProject, cleanupDir, readFile, pathExists } from "../helpers.js";

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
    store = new ProjectStore(projectRoot, pino({ level: "silent" }));
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("creates a project with all default files", async () => {
    await store.create("TestProject", "gemini-2.5-pro");
    const config = store.config.get();
    expect(config.name).toBe("TestProject");
    expect(config.defaultModel).toBe("gemini-2.5-pro");
    expect(config.paths.agents).toBe("agents");
    expect(pathExists(projectRoot, ".spherse/project.yaml")).toBe(true);
    expect(pathExists(projectRoot, ".spherse/agents")).toBe(true);
    expect(pathExists(projectRoot, "AGENTS.md")).toBe(true);
    expect(pathExists(projectRoot, "CHANGELOG.md")).toBe(true);
  });

  it("opens an existing project", async () => {
    await store.create("MyProject", "deepseek-v4-pro");
    const store2 = new ProjectStore(projectRoot, pino({ level: "silent" }));
    await store2.open();
    const config = store2.config.get();
    expect(config.name).toBe("MyProject");
    expect(config.defaultModel).toBe("deepseek-v4-pro");
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
    store = new ProjectStore(projectRoot, pino({ level: "silent" }));
    await store.create("TestProject", "gemini-2.5-pro");
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
    expect(index).toContain("世界观项目");
    await store.updateIndex("# Updated Index");
    expect(await store.readIndex()).toBe("# Updated Index");
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
    store = new ProjectStore(projectRoot, pino({ level: "silent" }));
    await store.create("TestProject", "gemini-2.5-pro");
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

  it("gets agent by id", async () => {
    const created = await store.createAgent("world-builder", VALID_PROFILE);
    const id = created.getProfile().id;
    expect(store.getAgent(id)).toBeDefined();
    expect(store.getAgent("nonexistent")).toBeUndefined();
  });

  it("loads agents on open", async () => {
    await store.createAgent("world-builder", VALID_PROFILE);
    await store.createAgent("lore-keeper", VALID_PROFILE.replace("World Builder", "Lore Keeper"));

    const store2 = new ProjectStore(projectRoot, pino({ level: "silent" }));
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

  it("rejects unsafe slug", async () => {
    await expect(store.createAgent("../bad", VALID_PROFILE)).rejects.toThrow(
      "invalid agent slug",
    );
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
    store = new ProjectStore(projectRoot, pino({ level: "silent" }));
    await store.create("TestProject", "gemini-2.5-pro");
  });

  afterEach(async () => {
    store.close();
    await cleanupDir(projectRoot);
  });

  it("agent store provides sessions and schedules getters", async () => {
    const agentStore = await store.createAgent("world-builder", VALID_PROFILE);

    const sessionId = agentStore.sessions.createSession("Test");
    expect(agentStore.sessions.getSession(sessionId)).not.toBeNull();

    agentStore.schedules.create({
      id: "sched-1",
      enabled: true,
      cron: "0 9 * * *",
      mode: "new_session",
      message: "hello",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(agentStore.schedules.list()).toHaveLength(1);
  });
});
