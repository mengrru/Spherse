import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { SkillDefinition } from "../types.js";

export class SkillStore {
  private skillDir: string;

  constructor(skillDir: string) {
    this.skillDir = path.resolve(skillDir);
  }

  async list(): Promise<SkillDefinition[]> {
    try {
      const entries = await fs.readdir(this.skillDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());

      const skills = await Promise.all(
        dirs.map((d) => this.parseSkill(d.name)),
      );
      return skills.filter((s): s is SkillDefinition => s !== null);
    } catch {
      return [];
    }
  }

  async get(name: string): Promise<SkillDefinition | null> {
    return this.parseSkill(name);
  }

  private async parseSkill(dirName: string): Promise<SkillDefinition | null> {
    const skillMdPath = path.resolve(this.skillDir, dirName, "SKILL.md");
    if (!skillMdPath.startsWith(this.skillDir)) return null;
    try {
      const raw = await fs.readFile(skillMdPath, "utf-8");
      const { data, content } = matter(raw);

      if (!data.name || !data.description) return null;

      return {
        name: data.name,
        description: data.description,
        instructions: content.trim(),
        filePath: skillMdPath,
      };
    } catch {
      return null;
    }
  }
}
