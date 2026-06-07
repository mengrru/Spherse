import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  normalizeDeniedPath,
  normalizeDeniedPaths,
} from "../access/ai-file-access.js";
import type { ProjectConfig } from "../types.js";
import { PROJECT_META_DIR } from "../types.js";
import type { Logger } from "../logger.js";
import pino from "pino";

export interface ChangelogEntry {
  agent: string;
  action: string;
  target: string;
  description: string;
}

const DEFAULT_PATHS = {
  agents: "agents",
  index: "AGENTS.md",
  changelog: "CHANGELOG.md",
};

const DEFAULT_AGENTS_MD = `# 世界观项目

> 此文件是项目的目录索引，供人类和 AI agent 阅读。

## 目录结构

请在此处描述你的世界观项目的目录结构。
`;

const WELCOME_PAGE_EXTENSIONS = new Set(["html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg"]);

function normalizeWelcomePagePath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized) return null;
  if (normalized === ".spherse" || normalized.startsWith(".spherse/")) return null;
  const ext = normalized.split(".").pop()?.toLowerCase();
  if (!ext || !WELCOME_PAGE_EXTENSIONS.has(ext)) return null;
  return normalized;
}

export class ProjectStore {
  private rootPath: string;
  private config: ProjectConfig | null = null;
  private spherseDir: string;
  private logger: Logger;

  constructor(rootPath: string, logger?: Logger) {
    this.rootPath = path.resolve(rootPath);
    this.spherseDir = path.join(this.rootPath, PROJECT_META_DIR);
    this.logger = logger ?? pino({ level: "silent" });
  }

  async create(name: string, defaultModel: string): Promise<ProjectConfig> {
    await fs.mkdir(this.spherseDir, { recursive: true });
    await fs.mkdir(path.join(this.spherseDir, DEFAULT_PATHS.agents), {
      recursive: true,
    });

    this.config = {
      name,
      created: Date.now(),
      defaultModel,
      paths: { ...DEFAULT_PATHS },
    };

    const configPath = path.join(this.spherseDir, "project.yaml");
    await fs.writeFile(configPath, YAML.stringify(this.config), "utf-8");

    const indexPath = path.join(this.rootPath, DEFAULT_PATHS.index);
    await fs.writeFile(indexPath, DEFAULT_AGENTS_MD, "utf-8");

    const changelogPath = path.join(this.rootPath, DEFAULT_PATHS.changelog);
    await fs.writeFile(changelogPath, "", "utf-8");

    this.logger.info({ rootPath: this.rootPath, name }, "project created");
    return this.config;
  }

  async open(): Promise<ProjectConfig> {
    const configPath = path.join(this.spherseDir, "project.yaml");
    if (!fsSync.existsSync(configPath)) {
      throw new Error(`project.yaml not found at ${configPath}`);
    }

    const raw = await fs.readFile(configPath, "utf-8");
    this.config = YAML.parse(raw) as ProjectConfig;
    this.logger.info({ rootPath: this.rootPath }, "project opened");
    return this.config;
  }

  getConfig(): ProjectConfig | null {
    return this.config;
  }

  getAiAccessSettings(): { deniedPaths: string[] } {
    return { deniedPaths: [...(this.config?.aiAccess?.deniedPaths ?? [])] };
  }

  getWelcomePageSettings(): { path: string | null } {
    return { path: this.config?.welcomePage?.path ?? null };
  }

  async updateWelcomePageSettings(
    welcomePath: string | null,
  ): Promise<{ path: string | null }> {
    if (!this.config) {
      throw new Error("Project is not open");
    }

    if (welcomePath !== null) {
      const normalized = normalizeWelcomePagePath(welcomePath);
      if (!normalized) {
        throw new Error(`Invalid welcome page path: ${welcomePath}`);
      }
      const nextConfig = { ...this.config, welcomePage: { path: normalized } };
      const configPath = path.join(this.spherseDir, "project.yaml");
      await fs.writeFile(configPath, YAML.stringify(nextConfig), "utf-8");
      this.config = nextConfig;
      return { path: normalized };
    }

    const { welcomePage: _, ...rest } = this.config;
    const nextConfig = rest as ProjectConfig;
    const configPath = path.join(this.spherseDir, "project.yaml");
    await fs.writeFile(configPath, YAML.stringify(nextConfig), "utf-8");
    this.config = nextConfig;
    return { path: null };
  }

  async updateAiAccessSettings(
    deniedPaths: string[],
  ): Promise<{ deniedPaths: string[] }> {
    if (!this.config) {
      throw new Error("Project is not open");
    }

    for (const deniedPath of deniedPaths) {
      if (!normalizeDeniedPath(deniedPath)) {
        throw new Error(`Invalid AI denied path: ${deniedPath}`);
      }
    }

    const aiAccess = { deniedPaths: normalizeDeniedPaths(deniedPaths) };
    const nextConfig = { ...this.config, aiAccess };

    const configPath = path.join(this.spherseDir, "project.yaml");
    await fs.writeFile(configPath, YAML.stringify(nextConfig), "utf-8");

    this.config = nextConfig;

    return { deniedPaths: [...aiAccess.deniedPaths] };
  }

  getRootPath(): string {
    return this.rootPath;
  }

  async readIndex(): Promise<string> {
    const indexPath = path.join(
      this.rootPath,
      this.config?.paths.index ?? DEFAULT_PATHS.index,
    );
    return fs.readFile(indexPath, "utf-8");
  }

  async updateIndex(content: string): Promise<void> {
    const indexPath = path.join(
      this.rootPath,
      this.config?.paths.index ?? DEFAULT_PATHS.index,
    );
    await fs.writeFile(indexPath, content, "utf-8");
  }

  async appendChangelog(entry: ChangelogEntry): Promise<void> {
    const changelogPath = path.join(
      this.rootPath,
      this.config?.paths.changelog ?? DEFAULT_PATHS.changelog,
    );
    const timestamp = new Date().toISOString();
    const line = `- **[${timestamp}]** ${entry.agent} / ${entry.action} / \`${entry.target}\` — ${entry.description}\n`;
    await fs.appendFile(changelogPath, line, "utf-8");
  }
}
