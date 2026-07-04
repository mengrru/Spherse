import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSilentLogger } from "../logger.js";
import { ProjectStore } from "../store/project.js";
import { PRESET_SKILL_SOURCES, PRESET_AGENTS } from "@spherse/presets";
import { createTempProject, cleanupDir, pathExists } from "./helpers.js";

describe("initPresets", () => {
  let projectRoot: string;
  let spherseDir: string;
  let projectStore: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    spherseDir = path.join(projectRoot, ".spherse");
    projectStore = new ProjectStore(projectRoot, createSilentLogger());
    await projectStore.create("TestProject");
  });

  afterEach(async () => {
    projectStore.close();
    await cleanupDir(projectRoot);
  });

  it("creates .spherse/skills/ directory but does not copy preset skills", async () => {
    const { initPresets } = await import("../presets.js");
    await initPresets(projectStore, spherseDir, createSilentLogger());

    expect(pathExists(projectRoot, ".spherse/skills")).toBe(true);
    for (const skill of PRESET_SKILL_SOURCES) {
      expect(pathExists(projectRoot, `.spherse/skills/${skill.dir}/SKILL.md`)).toBe(false);
    }
  });

  it("creates preset agents with correct names", async () => {
    const { initPresets } = await import("../presets.js");
    await initPresets(projectStore, spherseDir, createSilentLogger());

    const profiles = projectStore.listAgents();
    expect(profiles.length).toBeGreaterThanOrEqual(PRESET_AGENTS.length);

    for (const presetAgent of PRESET_AGENTS) {
      const profile = profiles.find((p) => p.name === presetAgent.name);
      expect(profile).toBeDefined();
      expect(profile!.slug).toMatch(new RegExp(`^${presetAgent.slug}-[a-f0-9]{6}$`));
    }
  });

  it("does not throw when called on empty project", async () => {
    const { initPresets } = await import("../presets.js");
    await expect(initPresets(projectStore, spherseDir, createSilentLogger())).resolves.toBeUndefined();
  });
});
