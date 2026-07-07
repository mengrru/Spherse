import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import { nanoid } from "nanoid";
import { PRESET_SKILL_SOURCES, AGENTS_INDEX_TEMPLATE } from "@spherse/presets";
import type { AgentProfile } from "../types.js";
import { PROJECT_META_DIR } from "../types.js";
import { ProjectConfigStore } from "./project-config.js";
import { SkillStore } from "./skill.js";
import { AgentStore } from "./agent-store.js";
import { AgentProfileStore, assertSafeSlug } from "./agent-profile.js";
import { type Logger, createSilentLogger } from "../logger.js";
import { ValidationError } from "../errors.js";

export interface ChangelogEntry {
  agent: string;
  action: string;
  target: string;
  description: string;
}

export class ProjectStore {
  private rootPath: string;
  private spherseDir: string;
  private logger: Logger;

  private _configStore: ProjectConfigStore | null = null;
  private _skillStore: SkillStore | null = null;
  private _agents: Map<string, AgentStore> = new Map();

  constructor(rootPath: string, logger?: Logger) {
    this.rootPath = path.resolve(rootPath);
    this.spherseDir = path.join(this.rootPath, PROJECT_META_DIR);
    this.logger = logger ?? createSilentLogger();
  }

  async open(): Promise<void> {
    const configPath = path.join(this.spherseDir, "project.yaml");
    this._configStore = new ProjectConfigStore(configPath, this.logger);
    await this._configStore.read();

    this._skillStore = new SkillStore(
      path.join(this.spherseDir, "skills"),
      PRESET_SKILL_SOURCES,
    );

    await this.loadAgents();
  }

  async create(name: string): Promise<void> {
    await fs.mkdir(this.spherseDir, { recursive: true });
    await fs.mkdir(path.join(this.spherseDir, "agents"), { recursive: true });

    const configPath = path.join(this.spherseDir, "project.yaml");
    this._configStore = new ProjectConfigStore(configPath, this.logger);
    await this._configStore.write({
      id: nanoid(8),
      name,
      created: Date.now(),
    });

    this._skillStore = new SkillStore(
      path.join(this.spherseDir, "skills"),
      PRESET_SKILL_SOURCES,
    );

    const indexPath = path.join(this.rootPath, "AGENTS.md");
    await fs.writeFile(indexPath, AGENTS_INDEX_TEMPLATE, "utf-8");

    const changelogPath = path.join(this.rootPath, "CHANGELOG.md");
    await fs.writeFile(changelogPath, "", "utf-8");

    this.logger.info({ rootPath: this.rootPath, name }, "project created");
  }

  private async loadAgents(): Promise<void> {
    const agentsDir = path.join(this.spherseDir, "agents");
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(agentsDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agentDir = path.join(agentsDir, entry.name);
      const profilePath = path.join(agentDir, "profile.md");
      const profileStore = new AgentProfileStore(profilePath, entry.name);
      const profile = await profileStore.read();
      if (!profile) continue;

      const agentStore = new AgentStore(agentDir, profile.id, this.logger);
      await agentStore.open();
      this._agents.set(profile.id, agentStore);
    }

    this.logger.info({ count: this._agents.size }, "agents loaded");
  }

  get config(): ProjectConfigStore {
    if (!this._configStore) throw new Error("Project is not open");
    return this._configStore;
  }

  get skill(): SkillStore {
    if (!this._skillStore) throw new Error("Project is not open");
    return this._skillStore;
  }

  get agents(): ReadonlyMap<string, AgentStore> {
    return this._agents;
  }

  getRootPath(): string {
    return this.rootPath;
  }

  listAgents(): AgentProfile[] {
    return [...this._agents.values()].map((a) => a.getProfile());
  }

  getAgent(agentId: string): AgentStore | undefined {
    return this._agents.get(agentId);
  }

  async createAgent(slug: string, content: string, themeContent?: string): Promise<AgentStore> {
    assertSafeSlug(slug);

    const { data, content: body } = matter(content);
    if (typeof data.name !== "string") {
      throw new ValidationError("agent profile name is required");
    }

    const id = crypto.randomUUID();
    const createdAt = typeof data.createdAt === "number" ? data.createdAt : Date.now();
    const frontmatter = { ...data, id, createdAt };
    const serialized = matter.stringify(body, frontmatter);

    const shortId = id.slice(0, 6);
    const dirName = `${slug}-${shortId}`;
    // TODO: 该处可能需要 slug 碰撞检测（查 agents Map + 文件系统），
    //       当前先假设 slug-shortid 不碰撞，后续按需补全
    const agentDir = path.join(this.spherseDir, "agents", dirName);
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "profile.md"), serialized, "utf-8");

    if (themeContent !== undefined) {
      await fs.writeFile(path.join(agentDir, "theme.css"), themeContent, "utf-8");
    }

    const agentStore = new AgentStore(agentDir, id, this.logger);
    await agentStore.open();
    this._agents.set(id, agentStore);
    this.logger.info({ agentId: id, slug }, "agent created");
    return agentStore;
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agentStore = this._agents.get(agentId);
    if (!agentStore) return;

    agentStore.close();
    const agentDir = agentStore.getAgentDir();
    await fs.rm(agentDir, { recursive: true, force: true });
    this._agents.delete(agentId);
    this.logger.info({ agentId }, "agent deleted");
  }

  async readIndex(): Promise<string> {
    const indexPath = path.join(this.rootPath, "AGENTS.md");
    try {
      return await fs.readFile(indexPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  }

  async updateIndex(content: string): Promise<void> {
    const indexPath = path.join(this.rootPath, "AGENTS.md");
    await fs.writeFile(indexPath, content, "utf-8");
  }

  async appendChangelog(entry: ChangelogEntry): Promise<void> {
    const changelogPath = path.join(this.rootPath, "CHANGELOG.md");
    const timestamp = new Date().toISOString();
    const line = `- **[${timestamp}]** ${entry.agent} / ${entry.action} / \`${entry.target}\` — ${entry.description}\n`;
    await fs.appendFile(changelogPath, line, "utf-8");
  }

  close(): void {
    for (const agentStore of this._agents.values()) {
      agentStore.close();
    }
    this._agents.clear();
  }
}
