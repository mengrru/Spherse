import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import AdmZip from "adm-zip";
import { nanoid } from "nanoid";
import type { SkillDefinition } from "../types.js";
import { isPathInside } from "../utils/path-safety.js";
import { shouldSkipDirEntry } from "../utils/fs-walk.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { ConflictError, ValidationError } from "../errors.js";

type PresetSkillSource = {
  dir: string;
  files: { relativePath: string; content: string }[];
};

const INVALID_SKILL_NAME_RE = /[/\\:]/;

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function moveDirAtomic(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== "EXDEV") throw err;
    try {
      await fs.cp(src, dest, { recursive: true });
    } catch (cpErr) {
      await fs.rm(dest, { recursive: true, force: true });
      throw cpErr;
    }
    await fs.rm(src, { recursive: true, force: true });
  }
}

export class SkillStore {
  private skillDir: string;
  private builtinSources?: readonly PresetSkillSource[];
  private fileWriteMutex: FileWriteMutex;

  constructor(skillDir: string, builtinSources?: readonly PresetSkillSource[]) {
    this.skillDir = path.resolve(skillDir);
    this.builtinSources = builtinSources;
    this.fileWriteMutex = new FileWriteMutex();
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

  async createSkill(name: string, description: string, instructions: string): Promise<SkillDefinition> {
    this.assertValidSkillName(name);
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedDescription) throw new ValidationError("skill description is required");

    const skillDir = path.join(this.skillDir, trimmedName);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    await this.fileWriteMutex.run(skillDir, async () => {
      if (await pathExists(skillDir)) {
        throw new ConflictError(`Skill "${trimmedName}" already exists`);
      }
      await fs.mkdir(skillDir, { recursive: true });
      const content = matter.stringify(instructions, { name: trimmedName, description: trimmedDescription });
      await fs.writeFile(skillMdPath, content, "utf-8");
    });

    const created = await this.get(trimmedName);
    if (!created) {
      throw new Error(`skill "${trimmedName}" not found after creation`);
    }
    return created;
  }

  async installSkill(zipPath: string): Promise<SkillDefinition> {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    if (entries.length === 0) {
      throw new ValidationError("skill package is empty");
    }

    const topLevelNames = new Set<string>();
    for (const entry of entries) {
      const parts = entry.entryName.split("/");
      const top = parts[0];
      if (!top) continue;
      if (!entry.isDirectory && parts.length === 1) {
        throw new ValidationError("skill package must contain a single top-level directory");
      }
      topLevelNames.add(top);
    }
    if (topLevelNames.size !== 1) {
      throw new ValidationError("skill package must contain a single top-level directory");
    }
    const skillFolder = [...topLevelNames][0];
    this.assertValidSkillName(skillFolder);

    const skillMdEntryName = `${skillFolder}/SKILL.md`;
    const skillMdEntry = entries.find((e) => e.entryName === skillMdEntryName);
    if (!skillMdEntry) {
      throw new ValidationError(`skill package is missing ${skillMdEntryName}`);
    }

    const parsed = matter(skillMdEntry.getData().toString("utf-8"));
    const fmName = parsed.data.name;
    const fmDescription = parsed.data.description;
    if (typeof fmName !== "string" || !fmName.trim() || typeof fmDescription !== "string" || !fmDescription.trim()) {
      throw new ValidationError("skill SKILL.md must have valid name and description frontmatter");
    }
    if (fmName !== skillFolder) {
      throw new ValidationError(
        `skill frontmatter name "${fmName}" does not match folder name "${skillFolder}"`,
      );
    }

    const targetDir = path.join(this.skillDir, skillFolder);
    const extractRoot = path.join(os.tmpdir(), `skill-install-${nanoid()}`);
    await fs.mkdir(extractRoot, { recursive: true });
    try {
      for (const entry of entries) {
        const resolved = path.resolve(extractRoot, entry.entryName);
        if (!isPathInside(extractRoot, resolved)) {
          throw new ValidationError(`zip entry escapes extraction directory: ${entry.entryName}`);
        }
      }
      zip.extractAllTo(extractRoot, true);

      const extractedSkillDir = path.join(extractRoot, skillFolder);
      if (!(await pathExists(extractedSkillDir))) {
        throw new ValidationError("skill package did not extract the expected directory");
      }

      await fs.mkdir(this.skillDir, { recursive: true });
      await this.fileWriteMutex.run(targetDir, async () => {
        if (await pathExists(targetDir)) {
          throw new ConflictError(`Skill "${skillFolder}" already exists`);
        }
        await moveDirAtomic(extractedSkillDir, targetDir);
      });
    } finally {
      await fs.rm(extractRoot, { recursive: true, force: true });
    }

    const installed = await this.get(skillFolder);
    if (!installed) {
      throw new Error(`skill "${skillFolder}" not found after install`);
    }
    return installed;
  }

  private assertValidSkillName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("skill name is required");
    if (INVALID_SKILL_NAME_RE.test(trimmed)) {
      throw new ValidationError("skill name must not contain '/', '\\', or ':'");
    }
    if (trimmed.startsWith(".")) {
      throw new ValidationError("skill name must not start with '.'");
    }
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

      const files = await this.collectSkillFiles(path.dirname(skillMdPath));
      return {
        name: data.name,
        description: data.description,
        instructions: content.trim(),
        filePath: skillMdPath,
        source: "project",
        files,
      };
    } catch {
      return null;
    }
  }

  private async collectSkillFiles(skillDirAbs: string): Promise<string[]> {
    const result: string[] = [];
    const walk = async (dir: string, prefix: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
      if (!entries) return;
      for (const entry of entries) {
        if (shouldSkipDirEntry(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), rel);
        } else if (rel !== "SKILL.md") {
          result.push(rel);
        }
      }
    };
    await walk(skillDirAbs, "");
    return result.sort();
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
        files: [],
      });
    }
    return skills;
  }
}
