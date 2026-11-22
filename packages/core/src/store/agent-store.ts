import path from "node:path";
import matter from "gray-matter";
import type { AgentProfile } from "../types.js";
import { AgentProfileStore } from "./agent-profile.js";
import { CORE_FILE, MEMORY_DIR, SqliteMemoryStore } from "./memory.js";
import { SqliteSessionStore } from "./session.js";
import { TriggerStore } from "./trigger.js";
import { SkillStore } from "./skill.js";
import { McpConfigStore } from "./mcp-config.js";
import type { ProjectStorageOptions } from "./storage-port.js";
import type { FsPort } from "./fs-port.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { type Logger, createSilentLogger } from "../logger.js";
import type { SessionChangePayload, SessionStorePort } from "./session.js";
import type { MemoryStorePort } from "./memory.js";

export class AgentStore {
  private agentDir: string;
  private relAgentDir: string;
  private agentId: string;
  private fsPort: FsPort;
  private _profile: AgentProfile | null = null;
  private _profileStore: AgentProfileStore;
  private _sessionStore: SessionStorePort | null = null;
  private _triggerStore: TriggerStore;
  private _skillStore: SkillStore | null = null;
  private _mcpStore: McpConfigStore | null = null;
  private _memoryStore: MemoryStorePort | null = null;
  private logger: Logger;

  constructor(
    agentDir: string,
    agentId: string,
    fsPort: FsPort,
    relAgentDir: string,
    logger?: Logger,
    fileWriteMutex?: FileWriteMutex,
    onSessionChange?: (payload: SessionChangePayload) => void,
    storage?: ProjectStorageOptions,
  ) {
    this.agentDir = agentDir;
    this.agentId = agentId;
    this.fsPort = fsPort;
    this.relAgentDir = relAgentDir;
    this.logger = logger ?? createSilentLogger();
    this.fileWriteMutex = fileWriteMutex;
    this.onSessionChange = onSessionChange;
    this.storage = storage;
    this._profileStore = new AgentProfileStore(
      fsPort,
      path.posix.join(relAgentDir, "profile.md"),
      path.join(agentDir, "profile.md"),
      path.basename(agentDir),
    );
    this._triggerStore = new TriggerStore(agentDir, logger);
  }

  private readonly storage?: ProjectStorageOptions;
  private fileWriteMutex?: FileWriteMutex;
  private readonly onSessionChange?: (payload: SessionChangePayload) => void;

  async open(): Promise<AgentProfile> {
    const profile = await this._profileStore.read();
    if (!profile) throw new Error(`agent profile not found at ${this.agentDir}`);
    this._profile = profile;
    return profile;
  }

  /**
   * Save profile content to disk and refresh the in-memory cache (`_profile`).
   * Must be used instead of `_profileStore.save()` directly: `getProfile()` returns the cached
   * `_profile`, so without refreshing it here, subsequent reads (e.g. when creating a new session)
   * would return the stale pre-edit profile.
   */
  async saveProfile(content: string): Promise<AgentProfile> {
    return this.runProfileLocked(() => this.saveProfileUnlocked(content));
  }

  async mutateProfileFrontmatter(
    mutate: (data: Record<string, unknown>) => void,
  ): Promise<AgentProfile> {
    return this.runProfileLocked(async () => {
      const raw = await this._profileStore.getRawContent();
      const parsed = matter(raw);
      mutate(parsed.data as Record<string, unknown>);
      const serialized = matter.stringify(parsed.content, parsed.data);
      return this.saveProfileUnlocked(serialized);
    });
  }

  private async runProfileLocked<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.fileWriteMutex) return fn();
    return this.fileWriteMutex.run(this._profileStore.getProfilePath(), fn);
  }

  private async saveProfileUnlocked(content: string): Promise<AgentProfile> {
    const profile = await this._profileStore.save(content);
    this._profile = profile;
    return profile;
  }

  getProfile(): AgentProfile {
    if (!this._profile) throw new Error("AgentStore not opened");
    return this._profile;
  }

  getAgentDir(): string {
    return this.agentDir;
  }

  getRelAgentDir(): string {
    return this.relAgentDir;
  }

  get profile(): AgentProfileStore {
    return this._profileStore;
  }

  get sessions(): SessionStorePort {
    if (!this._sessionStore) {
      this._sessionStore = this.storage?.sessionStoreFactory
        ? this.storage.sessionStoreFactory({
            agentId: this.agentId,
            agentDir: this.agentDir,
            logger: this.logger,
            onSessionChange: this.onSessionChange,
          })
        : new SqliteSessionStore(
            path.join(this.agentDir, "sessions.db"),
            this.agentId,
            this.logger,
            this.onSessionChange,
          );
    }
    return this._sessionStore;
  }

  get triggers(): TriggerStore {
    return this._triggerStore;
  }

  get skills(): SkillStore {
    if (!this._skillStore) {
      this._skillStore = new SkillStore(
        this.fsPort,
        path.posix.join(this.relAgentDir, "skills"),
        path.join(this.agentDir, "skills"),
        undefined,
        this.fileWriteMutex,
      );
    }
    return this._skillStore;
  }

  get mcp(): McpConfigStore {
    if (!this._mcpStore) {
      this._mcpStore = new McpConfigStore(
        this.fsPort,
        path.posix.join(this.relAgentDir, "mcp.json"),
        this.logger,
      );
    }
    return this._mcpStore;
  }

  get memory(): MemoryStorePort {
    if (!this._memoryStore) {
      this._memoryStore = this.storage?.memoryStoreFactory
        ? this.storage.memoryStoreFactory({ agentDir: this.agentDir, logger: this.logger, fsPort: this.fsPort })
        : new SqliteMemoryStore(
            this.agentDir,
            this.fsPort,
            path.posix.join(this.relAgentDir, MEMORY_DIR, CORE_FILE),
            this.logger,
          );
    }
    return this._memoryStore;
  }

  close(): void {
    this._sessionStore?.close();
    this._memoryStore?.close();
  }
}
