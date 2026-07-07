import type { ProjectManager } from "./project-manager.js";
import type { SessionManager } from "./session/session-manager.js";
import type { Scheduler } from "./scheduler.js";
import { type Logger, createSilentLogger } from "./logger.js";

export class ProjectRuntime {
  readonly projectManager: ProjectManager;
  readonly sessionRuntime: SessionManager;
  readonly scheduler: Scheduler;
  readonly projectId: string;
  private logger: Logger;
  private _shutdownDone = false;

  constructor(deps: {
    projectManager: ProjectManager;
    sessionRuntime: SessionManager;
    scheduler: Scheduler;
    projectId: string;
    logger?: Logger;
  }) {
    this.projectManager = deps.projectManager;
    this.sessionRuntime = deps.sessionRuntime;
    this.scheduler = deps.scheduler;
    this.projectId = deps.projectId;
    this.logger = deps.logger ?? createSilentLogger();
  }

  deleteSession(agentId: string, sessionId: string): void {
    this.sessionRuntime.destroySession(sessionId);
    this.projectManager.deleteSession(agentId, sessionId);
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.sessionRuntime.evictAgent(agentId);
    this.scheduler.unregisterAgent(agentId);
    await this.projectManager.deleteAgent(agentId);
  }

  async shutdown(): Promise<void> {
    if (this._shutdownDone) return;
    this._shutdownDone = true;
    this.logger.info({ projectId: this.projectId }, "project runtime shutting down");
    this.scheduler.stopAll();
    this.sessionRuntime.closeAll();
    this.projectManager.close();
  }
}
