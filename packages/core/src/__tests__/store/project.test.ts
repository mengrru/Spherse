import fs from "node:fs/promises";
import path from "node:path";
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
    expect(pathExists(projectRoot, ".spherse/project.yaml")).toBe(true);
    expect(pathExists(projectRoot, ".spherse/agents")).toBe(true);
    expect(pathExists(projectRoot, "AGENTS.md")).toBe(true);
    expect(pathExists(projectRoot, "CHANGELOG.md")).toBe(true);
  });

  it("has empty default AI access settings after create", async () => {
    await store.create("TestProject", "gemini-2.5-pro");

    const settings = store.getAiAccessSettings();

    expect(settings.deniedPaths).toEqual([]);
    settings.deniedPaths.push("mutated.md");
    expect(store.getAiAccessSettings().deniedPaths).toEqual([]);
  });

  it("throws when updating AI access settings before create or open", async () => {
    await expect(store.updateAiAccessSettings(["secrets.md"])).rejects.toThrow(
      "Project is not open",
    );
  });

  it("normalizes, deduplicates, persists, and reopens AI access settings", async () => {
    await store.create("TestProject", "gemini-2.5-pro");

    const settings = await store.updateAiAccessSettings([
      " lore/private/ ",
      "lore/private",
      "notes\\secret.md",
    ]);

    expect(settings.deniedPaths).toEqual(["lore/private", "notes/secret.md"]);
    expect(store.getAiAccessSettings().deniedPaths).toEqual([
      "lore/private",
      "notes/secret.md",
    ]);
    expect(await readFile(projectRoot, ".spherse/project.yaml")).toContain(
      "deniedPaths:",
    );

    const store2 = new ProjectStore(projectRoot);
    await store2.open();

    expect(store2.getAiAccessSettings().deniedPaths).toEqual([
      "lore/private",
      "notes/secret.md",
    ]);
  });

  it("rejects reserved AI denied paths before saving", async () => {
    await store.create("TestProject", "gemini-2.5-pro");

    await expect(store.updateAiAccessSettings(["AGENTS.md"])).rejects.toThrow(
      "Invalid AI denied path: AGENTS.md",
    );
    await expect(
      store.updateAiAccessSettings([".spherse/project.yaml"]),
    ).rejects.toThrow("Invalid AI denied path: .spherse/project.yaml");
    expect(store.getAiAccessSettings().deniedPaths).toEqual([]);
  });

  it("rejects invalid non-reserved AI denied paths", async () => {
    await store.create("TestProject", "gemini-2.5-pro");

    for (const deniedPath of ["", ".", "../secret.md", "/secret.md"]) {
      await expect(store.updateAiAccessSettings([deniedPath])).rejects.toThrow(
        `Invalid AI denied path: ${deniedPath}`,
      );
    }

    expect(store.getAiAccessSettings()).toEqual({ deniedPaths: [] });
  });

  it("rejects mixed valid and invalid AI denied paths without saving", async () => {
    await store.create("TestProject", "gemini-2.5-pro");

    await expect(
      store.updateAiAccessSettings(["secrets", "../secret.md"]),
    ).rejects.toThrow("Invalid AI denied path: ../secret.md");

    expect(store.getAiAccessSettings()).toEqual({ deniedPaths: [] });
  });

  it("keeps in-memory AI access settings unchanged when saving fails", async () => {
    await store.create("TestProject", "gemini-2.5-pro");
    await store.updateAiAccessSettings(["existing"]);

    const configPath = path.join(projectRoot, ".spherse/project.yaml");
    await fs.chmod(configPath, 0o444);
    try {
      await expect(store.updateAiAccessSettings(["new"])).rejects.toThrow();

      expect(store.getAiAccessSettings()).toEqual({ deniedPaths: ["existing"] });
    } finally {
      await fs.chmod(configPath, 0o644);
    }
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
