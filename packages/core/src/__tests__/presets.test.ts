import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentProfileStore } from "../store/agent-profile.js";
import { PRESET_SKILL_SOURCES, PRESET_AGENTS } from "@spherse/presets";
import { createTempProject, cleanupDir, pathExists, readFile } from "./helpers.js";

describe("initPresets", () => {
  let projectRoot: string;
  let spherseDir: string;
  let agentDir: string;
  let profileStore: AgentProfileStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    spherseDir = path.join(projectRoot, ".spherse");
    agentDir = path.join(spherseDir, "agents");
    await fs.mkdir(agentDir, { recursive: true });
    profileStore = new AgentProfileStore(agentDir);
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("copies all preset skills to .spherse/skills/", async () => {
    const { initPresets } = await import("../presets.js");
    await initPresets(projectRoot, spherseDir, profileStore);

    for (const skill of PRESET_SKILL_SOURCES) {
      for (const file of skill.files) {
        expect(pathExists(projectRoot, `.spherse/skills/${skill.dir}/${file.relativePath}`)).toBe(true);
        const content = await readFile(projectRoot, `.spherse/skills/${skill.dir}/${file.relativePath}`);
        expect(content).toBe(file.content);
      }
    }
  });

  it("creates preset agents with correct names", async () => {
    const { initPresets } = await import("../presets.js");
    await initPresets(projectRoot, spherseDir, profileStore);

    const profiles = await profileStore.list();
    expect(profiles.length).toBeGreaterThanOrEqual(PRESET_AGENTS.length);

    for (const presetAgent of PRESET_AGENTS) {
      const profile = profiles.find((p) => p.name === presetAgent.name);
      expect(profile).toBeDefined();
      expect(profile!.slug).toMatch(new RegExp(`^${presetAgent.slug}-[a-f0-9]{6}$`));
    }
  });

  it("does not throw when called on empty project", async () => {
    const { initPresets } = await import("../presets.js");
    await expect(initPresets(projectRoot, spherseDir, profileStore)).resolves.toBeUndefined();
  });
});
