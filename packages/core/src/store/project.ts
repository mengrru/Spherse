import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import matter from "gray-matter";
import { nanoid } from "nanoid";
import { PRESET_SKILL_SOURCES, AGENTS_INDEX_TEMPLATE } from "@spherse/presets";
import type { AgentProfile } from "../types.js";
import { PROJECT_META_DIR } from "../types.js";
import { ProjectConfigStore } from "./project-config.js";
import { SkillStore } from "./skill.js";
import { AgentStore } from "./agent-store.js";
import { AgentProfileStore, assertSafeSlug } from "./agent-profile.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { deriveAgentSlugBase, buildAgentDirName } from "./agent-slug.js";
import { type Logger, createSilentLogger } from "../logger.js";
import { ValidationError, NotFoundError } from "../errors.js";

export interface ChangelogEntry {
  agent: string;
  action: string;
  target: string;
  description: string;
}

export type AgentChangeAction = "created" | "updated" | "deleted";

export interface AgentChangePayload {
  agentId: string;
  action: AgentChangeAction;
}

/** Emits `agent_updated` (`AgentChangePayload`) whenever an agent is created, updated or deleted. */
export class ProjectStore extends EventEmitter {
  private rootPath: string;
  private spherseDir: string;
  private logger: Logger;
  private readonly fileWriteMutex?: FileWriteMutex;

  private _configStore: ProjectConfigStore | null = null;
  private _skillStore: SkillStore | null = null;
  private _agents: Map<string, AgentStore> = new Map();

  constructor(rootPath: string, logger?: Logger, fileWriteMutex?: FileWriteMutex) {
    super();
    this.rootPath = path.resolve(rootPath);
    this.spherseDir = path.join(this.rootPath, PROJECT_META_DIR);
    this.logger = logger ?? createSilentLogger();
    this.fileWriteMutex = fileWriteMutex;
  }

  async open(): Promise<void> {
    const configPath = path.join(this.spherseDir, "project.yaml");
    this._configStore = new ProjectConfigStore(configPath, this.logger);
    await this._configStore.read();

    this._skillStore = new SkillStore(
      path.join(this.spherseDir, "skills"),
      PRESET_SKILL_SOURCES,
      this.fileWriteMutex,
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
      this.fileWriteMutex,
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

      const agentStore = new AgentStore(agentDir, profile.id, this.logger, this.fileWriteMutex);
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
    return [...this._agents.values()]
      .map((a) => a.getProfile())
      .sort((a, b) => (typeof b.createdAt === "number" ? b.createdAt : 0) - (typeof a.createdAt === "number" ? a.createdAt : 0));
  }

  getAgent(agentId: string): AgentStore | undefined {
    return this._agents.get(agentId);
  }

  private async readAgentDirNames(): Promise<Set<string>> {
    const taken = new Set<string>();
    for (const agentStore of this._agents.values()) {
      taken.add(path.basename(agentStore.getAgentDir()));
    }
    try {
      const entries = await fs.readdir(path.join(this.spherseDir, "agents"), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) taken.add(entry.name);
      }
    } catch {
      // agents dir may not exist yet
    }
    return taken;
  }

  async createAgent(slugBase: string | undefined, content: string, themeContent?: string): Promise<AgentStore> {
    const { data, content: body } = matter(content);
    if (typeof data.name !== "string") {
      throw new ValidationError("agent profile name is required");
    }

    const id = crypto.randomUUID();
    const createdAt = typeof data.createdAt === "number" ? data.createdAt : Date.now();
    const frontmatter = { ...data, id, createdAt };
    const serialized = matter.stringify(body, frontmatter);

    const base = deriveAgentSlugBase(slugBase?.trim() ? slugBase : data.name);
    const dirName = buildAgentDirName(base, id, await this.readAgentDirNames());
    assertSafeSlug(dirName);
    const agentDir = path.join(this.spherseDir, "agents", dirName);
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "profile.md"), serialized, "utf-8");

    if (themeContent !== undefined) {
      await fs.writeFile(path.join(agentDir, "theme.css"), themeContent, "utf-8");
    }

    const agentStore = new AgentStore(agentDir, id, this.logger, this.fileWriteMutex);
    await agentStore.open();
    this._agents.set(id, agentStore);
    this.logger.info({ agentId: id, slug: dirName }, "agent created");
    this.emitAgentChange(id, "created");
    return agentStore;
  }

  async updateAgent(agentId: string, content: string, themeContent?: string): Promise<AgentStore> {
    const agentStore = this._agents.get(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    await agentStore.saveProfile(content);
    if (themeContent !== undefined) {
      await agentStore.profile.saveTheme(themeContent);
    }
    this.emitAgentChange(agentId, "updated");
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
    this.emitAgentChange(agentId, "deleted");
  }

  private emitAgentChange(agentId: string, action: AgentChangeAction): void {
    this.emit("agent_updated", { agentId, action } satisfies AgentChangePayload);
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
