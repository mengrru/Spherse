import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProjectStore } from "../../store/project.js";
import { createTempProject, cleanupDir, readFile, pathExists } from "../helpers.js";

describe("ProjectStore", () => {
  let projectRoot: string;
  let store: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    store = new ProjectStore(projectRoot);
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("creates a project with all default files", async () => {
    const config = await store.create("TestProject", "gemini-2.5-pro");
    expect(config.name).toBe("TestProject");
    expect(config.defaultModel).toBe("gemini-2.5-pro");
    expect(config.paths.agents).toBe("agents");
    expect(pathExists(projectRoot, ".pi/project.yaml")).toBe(true);
    expect(pathExists(projectRoot, ".pi/agents")).toBe(true);
    expect(pathExists(projectRoot, "AGENTS.md")).toBe(true);
    expect(pathExists(projectRoot, "CHANGELOG.md")).toBe(true);
  });

  it("opens an existing project", async () => {
    await store.create("MyProject", "deepseek-v4-pro");
    const store2 = new ProjectStore(projectRoot);
    const config = await store2.open();
    expect(config.name).toBe("MyProject");
    expect(config.defaultModel).toBe("deepseek-v4-pro");
  });

  it("throws when opening non-existent project", async () => {
    await expect(store.open()).rejects.toThrow("project.yaml not found");
  });

  it("returns null config before create/open", () => {
    expect(store.getConfig()).toBeNull();
  });

  it("returns root path", () => {
    expect(store.getRootPath()).toBe(projectRoot);
  });

  it("reads and updates index", async () => {
    await store.create("P", "m");
    const index = await store.readIndex();
    expect(index).toContain("世界观项目");
    await store.updateIndex("# Updated Index");
    expect(await store.readIndex()).toBe("# Updated Index");
  });

  it("appends changelog entries", async () => {
    await store.create("P", "m");
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
