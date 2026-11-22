import path from "node:path";
import matter from "gray-matter";
import type { SkillDefinition } from "../types.js";
import type { FsPort } from "./fs-port.js";
import type { SkillZipInstaller } from "./storage-port.js";
import { isPathInside } from "../utils/path-safety.js";
import { shouldSkipDirEntry } from "../utils/fs-walk.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { ConflictError, ValidationError } from "../errors.js";

type PresetSkillSource = {
  dir: string;
  files: { relativePath: string; content: string }[];
};

export interface AdditionalSkillDir {
  dir: string;
  relDir: string;
}

const INVALID_SKILL_NAME_RE = /[/\\:]/;

function parseSkillVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export class SkillStore {
  private skillDir: string;
  private relSkillDir: string;
  private additionalSkillDirs: AdditionalSkillDir[];
  private builtinSources?: readonly PresetSkillSource[];
  private fileWriteMutex: FileWriteMutex;
  private readonly zipInstaller?: SkillZipInstaller;
  private readonly fsPort: FsPort;

  constructor(
    fsPort: FsPort,
    relSkillDir: string,
    skillDir: string,
    builtinSources?: readonly PresetSkillSource[],
    fileWriteMutex?: FileWriteMutex,
    additionalSkillDirs: readonly AdditionalSkillDir[] = [],
    zipInstaller?: SkillZipInstaller,
  ) {
    this.fsPort = fsPort;
    this.relSkillDir = relSkillDir;
    this.zipInstaller = zipInstaller;
    this.skillDir = path.resolve(skillDir);
    this.additionalSkillDirs = additionalSkillDirs.map((d) => ({
      dir: path.resolve(d.dir),
      relDir: d.relDir,
    }));
    this.builtinSources = builtinSources;
    this.fileWriteMutex = fileWriteMutex ?? new FileWriteMutex();
  }

  async list(): Promise<SkillDefinition[]> {
    const byName = new Map<string, SkillDefinition>();

    for (const skill of this.parseBuiltin(this.builtinSources)) {
      byName.set(skill.name, skill);
    }

    for (const additionalSkillDir of this.additionalSkillDirs) {
      const additionalSkills = await this.listProject(additionalSkillDir.relDir, additionalSkillDir.dir);
      for (const skill of additionalSkills) {
        byName.set(skill.name, skill);
      }
    }

    const projectSkills = await this.listProject(this.relSkillDir, this.skillDir);
    for (const skill of projectSkills) {
      byName.set(skill.name, skill);
    }

    return Array.from(byName.values());
  }

  async get(name: string): Promise<SkillDefinition | null> {
    const projectSkill = await this.parseSkill(this.relSkillDir, this.skillDir, name);
    if (projectSkill) return projectSkill;

    for (const additionalSkillDir of this.additionalSkillDirs) {
      const additionalSkill = await this.parseSkill(additionalSkillDir.relDir, additionalSkillDir.dir, name);
      if (additionalSkill) return additionalSkill;
    }

    const builtin = this.parseBuiltin(this.builtinSources).find((s) => s.name === name);
    return builtin ?? null;
  }

  async createSkill(name: string, description: string, instructions: string): Promise<SkillDefinition> {
    this.assertValidSkillName(name);
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedDescription) throw new ValidationError("skill description is required");

    const relSkillDir = path.posix.join(this.relSkillDir, trimmedName);
    await this.fileWriteMutex.run(path.join(this.skillDir, trimmedName), async () => {
      if ((await this.fsPort.stat(relSkillDir).catch(() => null)) !== null) {
        throw new ConflictError(`Skill "${trimmedName}" already exists`);
      }
      await this.fsPort.mkdirp(relSkillDir);
      const content = matter.stringify(instructions, { name: trimmedName, description: trimmedDescription });
      await this.fsPort.writeFile(path.posix.join(relSkillDir, "SKILL.md"), content);
    });

    const created = await this.get(trimmedName);
    if (!created) {
      throw new Error(`skill "${trimmedName}" not found after creation`);
    }
    return created;
  }

  async installSkill(zipPath: string, options?: { overwrite?: boolean }): Promise<SkillDefinition> {
    if (!this.zipInstaller) {
      throw new Error("skill zip install is not supported on this host");
    }
    const skillFolder = await this.zipInstaller(zipPath, this.skillDir, this.fileWriteMutex, options);

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

  private async listProject(relDir: string, dir: string): Promise<SkillDefinition[]> {
    try {
      const entries = await this.fsPort.readdir(relDir);
      const dirs = entries.filter((e) => e.isDirectory);
      const skills = await Promise.all(dirs.map((d) => this.parseSkill(relDir, dir, d.name)));
      return skills.filter((s): s is SkillDefinition => s !== null);
    } catch {
      return [];
    }
  }

  private async parseSkill(relDir: string, dir: string, dirName: string): Promise<SkillDefinition | null> {
    const skillMdPath = path.resolve(dir, dirName, "SKILL.md");
    if (!isPathInside(dir, skillMdPath)) return null;
    try {
      const raw = await this.fsPort.readFile(path.posix.join(relDir, dirName, "SKILL.md"));
      const { data, content } = matter(raw);

      if (!data.name || !data.description) return null;

      const files = await this.collectSkillFiles(path.posix.join(relDir, dirName));
      return {
        name: data.name,
        description: data.description,
        instructions: content.trim(),
        filePath: skillMdPath,
        source: "project",
        files,
        version: parseSkillVersion(data.version),
      };
    } catch {
      return null;
    }
  }

  private async collectSkillFiles(relSkillDir: string): Promise<string[]> {
    const result: string[] = [];
    const walk = async (rel: string) => {
      const entries = await this.fsPort.readdir(rel).catch(() => null);
      if (!entries) return;
      for (const entry of entries) {
        if (shouldSkipDirEntry(entry.name)) continue;
        const relName = rel === relSkillDir ? entry.name : `${rel.slice(relSkillDir.length + 1)}/${entry.name}`;
        if (entry.isDirectory) {
          await walk(path.posix.join(rel, entry.name));
        } else if (relName !== "SKILL.md") {
          result.push(relName);
        }
      }
    };
    await walk(relSkillDir);
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
        version: parseSkillVersion(data.version),
      });
    }
    return skills;
  }
}
