import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ProjectConfig } from "../types.js";
import { PROJECT_META_DIR } from "../types.js";

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

export class ProjectStore {
  private rootPath: string;
  private config: ProjectConfig | null = null;
  private spherseDir: string;

  constructor(rootPath: string) {
    this.rootPath = path.resolve(rootPath);
    this.spherseDir = path.join(this.rootPath, PROJECT_META_DIR);
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

    return this.config;
  }

  async open(): Promise<ProjectConfig> {
    const configPath = path.join(this.spherseDir, "project.yaml");
    if (!fsSync.existsSync(configPath)) {
      throw new Error(`project.yaml not found at ${configPath}`);
    }

    const raw = await fs.readFile(configPath, "utf-8");
    this.config = YAML.parse(raw) as ProjectConfig;
    return this.config;
  }

  getConfig(): ProjectConfig | null {
    return this.config;
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
