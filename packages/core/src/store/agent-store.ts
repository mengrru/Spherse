import path from "node:path";
import type { AgentProfile } from "../types.js";
import { AgentProfileStore } from "./agent-profile.js";
import { SessionStore } from "./session.js";
import { ScheduleStore } from "./schedule.js";
import type { Logger } from "../logger.js";
import pino from "pino";

export class AgentStore {
  private agentDir: string;
  private agentId: string;
  private _profile: AgentProfile | null = null;
  private _profileStore: AgentProfileStore;
  private _sessionStore: SessionStore | null = null;
  private _scheduleStore: ScheduleStore;
  private logger: Logger;

  constructor(agentDir: string, agentId: string, logger?: Logger) {
    this.agentDir = agentDir;
    this.agentId = agentId;
    this.logger = logger ?? pino({ level: "silent" });
    this._profileStore = new AgentProfileStore(
      path.join(agentDir, "profile.md"),
      path.basename(agentDir),
    );
    this._scheduleStore = new ScheduleStore(agentDir, logger);
  }

  async open(): Promise<AgentProfile> {
    const profile = await this._profileStore.read();
    if (!profile) throw new Error(`agent profile not found at ${this.agentDir}`);
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

  get schedules(): ScheduleStore {
    return this._scheduleStore;
  }

  close(): void {
    this._sessionStore?.close();
  }
}
