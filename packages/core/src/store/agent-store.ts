import path from "node:path";
import type { AgentProfile } from "../types.js";
import { AgentProfileStore } from "./agent-profile.js";
import { SessionStore } from "./session.js";
import { TriggerStore } from "./trigger.js";
import { type Logger, createSilentLogger } from "../logger.js";

export class AgentStore {
  private agentDir: string;
  private agentId: string;
  private _profile: AgentProfile | null = null;
  private _profileStore: AgentProfileStore;
  private _sessionStore: SessionStore | null = null;
  private _triggerStore: TriggerStore;
  private logger: Logger;

  constructor(agentDir: string, agentId: string, logger?: Logger) {
    this.agentDir = agentDir;
    this.agentId = agentId;
    this.logger = logger ?? createSilentLogger();
    this._profileStore = new AgentProfileStore(
      path.join(agentDir, "profile.md"),
      path.basename(agentDir),
    );
    this._triggerStore = new TriggerStore(agentDir, logger);
  }

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

  get profile(): AgentProfileStore {
    return this._profileStore;
  }

  get sessions(): SessionStore {
    if (!this._sessionStore) {
      this._sessionStore = new SessionStore(
        path.join(this.agentDir, "sessions.db"),
        this.agentId,
        this.logger,
      );
    }
    return this._sessionStore;
  }

  get triggers(): TriggerStore {
    return this._triggerStore;
  }

  close(): void {
    this._sessionStore?.close();
  }
}
