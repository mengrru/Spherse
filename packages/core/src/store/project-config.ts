import fs from "node:fs/promises";
import fsSync from "node:fs";
import YAML from "yaml";
import { nanoid } from "nanoid";
import {
  normalizeDeniedPath,
  normalizeDeniedPaths,
} from "../access/denied-paths.js";
import type { ProjectConfig } from "../types.js";
import { type Logger, createSilentLogger } from "../logger.js";
import { ValidationError, ProjectConfigNotFoundError, ProjectConfigParseError } from "../errors.js";
import { categorizePath } from "../access/path-category.js";

const WELCOME_PAGE_EXTENSIONS = new Set(["html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg"]);

function normalizeWelcomePagePath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized) return null;
  if (categorizePath(normalized) !== "userFiles") return null;
  const ext = normalized.split(".").pop()?.toLowerCase();
  if (!ext || !WELCOME_PAGE_EXTENSIONS.has(ext)) return null;
  return normalized;
}

export class ProjectConfigStore {
  private configPath: string;
  private config: ProjectConfig | null = null;
  private logger: Logger;

  constructor(configPath: string, logger?: Logger) {
    this.configPath = configPath;
    this.logger = logger ?? createSilentLogger();
  }

  async read(): Promise<ProjectConfig> {
    if (!fsSync.existsSync(this.configPath)) {
      throw new ProjectConfigNotFoundError(`project.yaml not found at ${this.configPath}`);
    }

    const raw = await fs.readFile(this.configPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      throw new ProjectConfigParseError(
        `project.yaml is not valid YAML at ${this.configPath}: ${(err as Error).message}`,
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ProjectConfigParseError(`project.yaml is empty or invalid at ${this.configPath}`);
    }
    this.config = parsed as ProjectConfig;

    if (!this.config.id) {
      this.config.id = nanoid(8);
      await fs.writeFile(this.configPath, YAML.stringify(this.config), "utf-8");
      this.logger.info({ id: this.config.id }, "project id generated for legacy project");
    }

    return this.config;
  }

  async write(config: ProjectConfig): Promise<void> {
    this.config = config;
    await fs.writeFile(this.configPath, YAML.stringify(config), "utf-8");
  }

  get(): ProjectConfig {
    if (!this.config) throw new Error("Project config not loaded");
    return this.config;
  }

  getProjectId(): string {
    return this.get().id;
  }

  async regenerateProjectId(newId: string): Promise<void> {
    const next = { ...this.get(), id: newId };
    await this.write(next);
    this.logger.info({ newId }, "project id regenerated");
  }

  getAiAccessSettings(): { deniedPaths: string[] } {
    return { deniedPaths: [...(this.get().aiAccess?.deniedPaths ?? [])] };
  }

  async updateAiAccessSettings(
    deniedPaths: string[],
  ): Promise<{ deniedPaths: string[] }> {
    for (const deniedPath of deniedPaths) {
      if (!normalizeDeniedPath(deniedPath)) {
        throw new ValidationError(`Invalid AI denied path: ${deniedPath}`);
      }
    }

    const aiAccess = { deniedPaths: normalizeDeniedPaths(deniedPaths) };
    await this.write({ ...this.get(), aiAccess });
    return { deniedPaths: [...aiAccess.deniedPaths] };
  }

  getWelcomePageSettings(): { path: string | null } {
    return { path: this.get().welcomePage?.path ?? null };
  }

  async updateWelcomePageSettings(
    welcomePath: string | null,
  ): Promise<{ path: string | null }> {
    if (welcomePath !== null) {
      const normalized = normalizeWelcomePagePath(welcomePath);
      if (!normalized) {
        throw new ValidationError(`Invalid welcome page path: ${welcomePath}`);
      }
      await this.write({ ...this.get(), welcomePage: { path: normalized } });
      return { path: normalized };
    }

    const { welcomePage: _, ...rest } = this.get();
    await this.write(rest as ProjectConfig);
    return { path: null };
  }
}
