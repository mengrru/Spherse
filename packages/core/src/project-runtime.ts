import type { ProjectManager } from "./project-manager.js";
import type { SessionManager } from "./session/session-manager.js";
import type { TriggerManager } from "./trigger/trigger-manager.js";
import type { TimerService } from "./trigger/timer-service.js";
import { type Logger, createSilentLogger } from "./logger.js";

export class ProjectRuntime {
  readonly projectManager: ProjectManager;
  readonly sessionRuntime: SessionManager;
  readonly triggerManager: TriggerManager;
  readonly timerService: TimerService;
  readonly projectId: string;
  private logger: Logger;
  private _shutdownDone = false;

  constructor(deps: {
    projectManager: ProjectManager;
    sessionRuntime: SessionManager;
    triggerManager: TriggerManager;
    timerService: TimerService;
    projectId: string;
    logger?: Logger;
  }) {
    this.projectManager = deps.projectManager;
    this.sessionRuntime = deps.sessionRuntime;
    this.triggerManager = deps.triggerManager;
    this.timerService = deps.timerService;
    this.projectId = deps.projectId;
    this.logger = deps.logger ?? createSilentLogger();
  }

  deleteSession(agentId: string, sessionId: string): void {
    this.sessionRuntime.destroySession(sessionId);
    this.projectManager.deleteSession(agentId, sessionId);
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.sessionRuntime.evictAgent(agentId);
    this.triggerManager.deleteAllForAgent(agentId);
    await this.projectManager.deleteAgent(agentId);
  }

  async shutdown(): Promise<void> {
    if (this._shutdownDone) return;
    this._shutdownDone = true;
    this.logger.info({ projectId: this.projectId }, "project runtime shutting down");
    this.timerService.stop();
    this.triggerManager.stopAll();
    this.sessionRuntime.closeAll();
    this.projectManager.close();
  }
}
