import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import matter from "gray-matter";
import { nanoid } from "nanoid";
import { PRESET_SKILL_SOURCES, AGENTS_INDEX_TEMPLATE } from "@spherse/presets";
import type { AgentProfile } from "../types.js";
import type { AgentMcpConfig } from "../mcp/types.js";
import { PROJECT_META_DIR } from "../types.js";
import { ProjectConfigStore } from "./project-config.js";
import { SkillStore } from "./skill.js";
import { AgentStore } from "./agent-store.js";
import type { ProjectStorageOptions } from "./storage-port.js";
import type { FsPort } from "./fs-port.js";
import { NodeFsPort } from "./node-fs-port.js";
import { AgentProfileStore, assertSafeSlug } from "./agent-profile.js";
import type { SessionChangePayload } from "./session.js";
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

/** Emits `agent_updated` (`AgentChangePayload`) whenever an agent is created, updated or deleted,
 *  and `session_updated` (`SessionChangePayload`) whenever a session is created, renamed or deleted. */
export class ProjectStore extends EventEmitter {
  private rootPath: string;
  private spherseDir: string;
  private logger: Logger;
  private readonly storage?: ProjectStorageOptions;
  private readonly fileWriteMutex?: FileWriteMutex;
  private readonly fsPort: FsPort;

  private _configStore: ProjectConfigStore | null = null;
  private _skillStore: SkillStore | null = null;
  private _agents: Map<string, AgentStore> = new Map();

  constructor(
    rootPath: string,
    logger?: Logger,
    fileWriteMutex?: FileWriteMutex,
    storage?: ProjectStorageOptions,
  ) {
    super();
    this.rootPath = path.resolve(rootPath);
    this.spherseDir = path.join(this.rootPath, PROJECT_META_DIR);
    this.logger = logger ?? createSilentLogger();
    this.fileWriteMutex = fileWriteMutex;
    this.storage = storage;
    this.fsPort = storage?.fsPort ?? new NodeFsPort(this.rootPath);
  }

  private createSkillStore(): SkillStore {
    return new SkillStore(
      this.fsPort,
      path.posix.join(PROJECT_META_DIR, "skills"),
      path.join(this.spherseDir, "skills"),
      PRESET_SKILL_SOURCES,
      this.fileWriteMutex,
      [{ dir: path.join(this.rootPath, ".agents", "skills"), relDir: path.posix.join(".agents", "skills") }],
    );
  }

  async open(): Promise<void> {
    this._configStore = new ProjectConfigStore(
      this.fsPort,
      path.posix.join(PROJECT_META_DIR, "project.yaml"),
      this.logger,
    );
    await this._configStore.read();

    this._skillStore = this.createSkillStore();

    await this.loadAgents();
  }

  async create(name: string): Promise<void> {
    await this.fsPort.mkdirp(PROJECT_META_DIR);
    await this.fsPort.mkdirp(path.posix.join(PROJECT_META_DIR, "agents"));

    this._configStore = new ProjectConfigStore(
      this.fsPort,
      path.posix.join(PROJECT_META_DIR, "project.yaml"),
      this.logger,
    );
    await this._configStore.write({
      id: nanoid(8),
      name,
      created: Date.now(),
    });

    this._skillStore = this.createSkillStore();

    await this.fsPort.writeFileIfMissing("AGENTS.md", AGENTS_INDEX_TEMPLATE);

    await this.fsPort.writeFileIfMissing("CHANGELOG.md", "");

    this.logger.info({ rootPath: this.rootPath, name }, "project created");
  }

  private async loadAgents(): Promise<void> {
    let entries;
    try {
      entries = await this.fsPort.readdir(path.posix.join(PROJECT_META_DIR, "agents"));
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const relAgentDir = path.posix.join(PROJECT_META_DIR, "agents", entry.name);
      const agentDir = path.join(this.spherseDir, "agents", entry.name);
      const profileStore = new AgentProfileStore(
        this.fsPort,
        path.posix.join(relAgentDir, "profile.md"),
        path.join(agentDir, "profile.md"),
        entry.name,
      );
      const profile = await profileStore.read();
      if (!profile) continue;

      const agentStore = new AgentStore(agentDir, profile.id, this.fsPort, relAgentDir, this.logger, this.fileWriteMutex, this.forwardSessionChange, this.storage);
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

  getFsPort(): FsPort {
    return this.fsPort;
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
      const entries = await this.fsPort.readdir(path.posix.join(PROJECT_META_DIR, "agents"));
      for (const entry of entries) {
        if (entry.isDirectory) taken.add(entry.name);
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
    const relAgentDir = path.posix.join(PROJECT_META_DIR, "agents", dirName);
    const agentDir = path.join(this.spherseDir, "agents", dirName);
    await this.fsPort.mkdirp(relAgentDir);
    await this.fsPort.writeFile(path.posix.join(relAgentDir, "profile.md"), serialized);

    if (themeContent !== undefined) {
      await this.fsPort.writeFile(path.posix.join(relAgentDir, "theme.css"), themeContent);
    }

    const agentStore = new AgentStore(agentDir, id, this.fsPort, relAgentDir, this.logger, this.fileWriteMutex, this.forwardSessionChange, this.storage);
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

  async updateAgentFrontmatter(
    agentId: string,
    mutate: (data: Record<string, unknown>) => void,
  ): Promise<AgentStore> {
    const agentStore = this._agents.get(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    await agentStore.mutateProfileFrontmatter(mutate);
    this.emitAgentChange(agentId, "updated");
    return agentStore;
  }

  async updateAgentMcp(
    agentId: string,
    config: { servers: ReadonlyArray<Record<string, unknown>> },
  ): Promise<AgentMcpConfig> {
    const agentStore = this._agents.get(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    const normalized = await agentStore.mcp.saveConfig(config);
    this.emitAgentChange(agentId, "updated");
    return normalized;
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agentStore = this._agents.get(agentId);
    if (!agentStore) return;

    agentStore.close();
    await this.fsPort.rm(agentStore.getRelAgentDir(), { recursive: true });
    this._agents.delete(agentId);
    this.logger.info({ agentId }, "agent deleted");
    this.emitAgentChange(agentId, "deleted");
  }

  private emitAgentChange(agentId: string, action: AgentChangeAction): void {
    this.emit("agent_updated", { agentId, action } satisfies AgentChangePayload);
  }

  private readonly forwardSessionChange = (payload: SessionChangePayload): void => {
    this.emit("session_updated", payload);
  };

  async readIndex(): Promise<string> {
    try {
      return await this.fsPort.readFile("AGENTS.md");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  }

  async updateIndex(content: string): Promise<void> {
    await this.fsPort.writeFile("AGENTS.md", content);
  }

  async appendChangelog(entry: ChangelogEntry): Promise<void> {
    const timestamp = new Date().toISOString();
    const line = `- **[${timestamp}]** ${entry.agent} / ${entry.action} / \`${entry.target}\` — ${entry.description}\n`;
    await this.fsPort.appendFile("CHANGELOG.md", line);
  }

  close(): void {
    for (const agentStore of this._agents.values()) {
      agentStore.close();
    }
    this._agents.clear();
  }
}
