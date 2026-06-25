import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { SkillDefinition } from "../types.js";
import { isPathInside } from "../utils/path-safety.js";

type PresetSkillSource = {
  dir: string;
  files: { relativePath: string; content: string }[];
};

export class SkillStore {
  private skillDir: string;
  private builtinSources?: readonly PresetSkillSource[];

  constructor(skillDir: string, builtinSources?: readonly PresetSkillSource[]) {
    this.skillDir = path.resolve(skillDir);
    this.builtinSources = builtinSources;
  }

  async list(): Promise<SkillDefinition[]> {
    const byName = new Map<string, SkillDefinition>();

    for (const skill of this.parseBuiltin(this.builtinSources)) {
      byName.set(skill.name, skill);
    }

    const projectSkills = await this.listProject();
    for (const skill of projectSkills) {
      byName.set(skill.name, skill);
    }

    return Array.from(byName.values());
  }

  async get(name: string): Promise<SkillDefinition | null> {
    const projectSkill = await this.parseSkill(name);
    if (projectSkill) return projectSkill;

    const builtin = this.parseBuiltin(this.builtinSources).find((s) => s.name === name);
    return builtin ?? null;
  }

  private async listProject(): Promise<SkillDefinition[]> {
    try {
      const entries = await fs.readdir(this.skillDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());
      const skills = await Promise.all(dirs.map((d) => this.parseSkill(d.name)));
      return skills.filter((s): s is SkillDefinition => s !== null);
    } catch {
      return [];
    }
  }

  private async parseSkill(dirName: string): Promise<SkillDefinition | null> {
    const skillMdPath = path.resolve(this.skillDir, dirName, "SKILL.md");
    if (!isPathInside(this.skillDir, skillMdPath)) return null;
    try {
      const raw = await fs.readFile(skillMdPath, "utf-8");
      const { data, content } = matter(raw);

      if (!data.name || !data.description) return null;

      return {
        name: data.name,
        description: data.description,
        instructions: content.trim(),
        filePath: skillMdPath,
        source: "project",
      };
    } catch {
      return null;
    }
  }

  private parseBuiltin(
    sources: readonly PresetSkillSource[] | undefined,
  ): SkillDefinition[] {
    if (!sources) return [];
    const skills: SkillDefinition[] = [];
    for (const source of sources) {
      const skillFile = source.files.find((f) => f.relativePath === "SKILL.md");
      if (!skillFile) continue;
      const { data, content } = matter(skillFile.content);
      if (!data.name || !data.description) continue;
      skills.push({
        name: data.name,
        description: data.description,
        instructions: content.trim(),
        filePath: `builtin://${source.dir}/SKILL.md`,
        source: "builtin",
      });
    }
    return skills;
  }
}
