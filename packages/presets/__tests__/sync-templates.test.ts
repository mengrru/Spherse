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
      expect(content).toContain(`"slugBase": "${agent.slugBase}"`);
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

  it("generates agent-template.ts with AGENT_TEMPLATE constant matching the source template", async () => {
    const content = fs.readFileSync(
      path.join(generatedDir, "agent-template.ts"),
      "utf8",
    );
    expect(content).toContain("export const AGENT_TEMPLATE");
    expect(content).toContain("tools:");
    const { AGENT_TEMPLATE } = await import(
      "../src/generated/agent-template.js"
    );
    const sourceFile = fs.readFileSync(
      path.join(rootDir, "templates", "agent-template.md"),
      "utf-8",
    );
    expect(AGENT_TEMPLATE).toBe(sourceFile);
  });

  it("generates agents-index-template.ts with AGENTS_INDEX_TEMPLATE constant", async () => {
    const content = fs.readFileSync(
      path.join(generatedDir, "agents-index-template.ts"),
      "utf-8",
    );
    expect(content).toContain("export const AGENTS_INDEX_TEMPLATE");
    const { AGENTS_INDEX_TEMPLATE } = await import(
      "../src/generated/agents-index-template.js"
    );
    expect(typeof AGENTS_INDEX_TEMPLATE).toBe("string");
    expect(AGENTS_INDEX_TEMPLATE.length).toBeGreaterThan(0);
    const sourceFile = fs.readFileSync(
      path.join(rootDir, "templates", "agents-index-template.md"),
      "utf-8",
    );
    expect(AGENTS_INDEX_TEMPLATE).toBe(sourceFile);
  });

  it("generates prompt-templates.ts with PRESET_PROMPT_TEMPLATES matching presets.json", async () => {
    const content = fs.readFileSync(
      path.join(generatedDir, "prompt-templates.ts"),
      "utf-8",
    );
    expect(content).toContain("export const PRESET_PROMPT_TEMPLATES");

    const { PRESET_PROMPT_TEMPLATES } = await import(
      "../src/generated/prompt-templates.js"
    );

    const declared = presetsConfig.presetPromptTemplates;
    expect(PRESET_PROMPT_TEMPLATES.length).toBe(declared.length);

    const ids = declared.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const tpl of PRESET_PROMPT_TEMPLATES) {
      const declaredTpl = declared.find((d) => d.id === tpl.id);
      expect(declaredTpl).toBeDefined();
      expect(tpl.name).toBe(declaredTpl.name);
      const mdPath = path.join(rootDir, "templates", "prompt-templates", `${tpl.id}.md`);
      expect(fs.existsSync(mdPath)).toBe(true);
      const actual = fs.readFileSync(mdPath, "utf-8");
      expect(tpl.prompt).toBe(actual);
    }
  });
});
