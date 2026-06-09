import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const generatedDir = path.join(rootDir, "src", "generated");

describe("sync-templates", () => {
  const presetsConfig = JSON.parse(
    fs.readFileSync(path.join(rootDir, "presets.json"), "utf-8"),
  );

  it("generates presets.ts with PRESET_SKILLS and PRESET_AGENTS matching presets.json", () => {
    const content = fs.readFileSync(
      path.join(generatedDir, "presets.ts"),
      "utf-8",
    );
    expect(content).toContain("export const PRESET_SKILLS");
    expect(content).toContain("export const PRESET_AGENTS");

    for (const skill of presetsConfig.presetSkills) {
      expect(content).toContain(`"dir": "${skill.dir}"`);
    }
    for (const agent of presetsConfig.presetAgents) {
      expect(content).toContain(`"name": "${agent.name}"`);
      expect(content).toContain(`"slug": "${agent.slug}"`);
    }
  });

  it("generates preset-skills.ts with file entries for each declared skill", async () => {
    const content = fs.readFileSync(
      path.join(generatedDir, "preset-skills.ts"),
      "utf-8",
    );
    expect(content).toContain("export const PRESET_SKILL_SOURCES");

    const { PRESET_SKILL_SOURCES } = await import(
      "../src/generated/preset-skills.js"
    );

    expect(PRESET_SKILL_SOURCES.length).toBe(
      presetsConfig.presetSkills.length,
    );

    for (const source of PRESET_SKILL_SOURCES) {
      expect(source.dir).toBeDefined();
      expect(source.files.length).toBeGreaterThanOrEqual(1);
      const skillMd = source.files.find(
        (f) => f.relativePath === "SKILL.md",
      );
      expect(skillMd).toBeDefined();
      expect(skillMd?.content).toBeTruthy();

      const skillDir = path.join(rootDir, "skills", source.dir);
      for (const file of source.files) {
        const fullPath = path.join(skillDir, file.relativePath);
        expect(fs.existsSync(fullPath)).toBe(true);
        const actual = fs.readFileSync(fullPath, "utf-8");
        expect(file.content).toBe(actual);
      }
    }
  });

  it("generates agent-template.ts with AGENT_TEMPLATE constant", () => {
    const content = fs.readFileSync(
      path.join(generatedDir, "agent-template.ts"),
      "utf-8",
    );
    expect(content).toContain("export const AGENT_TEMPLATE");
    expect(content).toContain("name: ");
  });
});
