import type { ProjectManager } from "./project-manager.js";
import type { SessionManager } from "./session/session-manager.js";
import type { TriggerManager } from "./trigger/trigger-manager.js";
import type { TimerService } from "./trigger/timer-service.js";
import type { AgentMcpConfig } from "./mcp/index.js";
import type { TriggerCapability } from "./capabilities/trigger/index.js";
import type { Capability } from "./kernel/capability.js";
import type { AgentProfile } from "./types.js";
import { type Logger, createSilentLogger } from "./logger.js";

export class ProjectRuntime {
  readonly projectManager: ProjectManager;
  readonly sessionRuntime: SessionManager;
  readonly projectId: string;
  private logger: Logger;
  private _shutdownDone = false;
  private readonly capabilities: ReadonlyArray<Capability>;

  constructor(deps: {
    projectManager: ProjectManager;
    sessionRuntime: SessionManager;
    projectId: string;
    logger?: Logger;
    capabilities: ReadonlyArray<Capability>;
  }) {
    this.projectManager = deps.projectManager;
    this.sessionRuntime = deps.sessionRuntime;
    this.projectId = deps.projectId;
    this.logger = deps.logger ?? createSilentLogger();
    this.capabilities = deps.capabilities;
  }

  private triggerCapability(): TriggerCapability | undefined {
    return this.capabilities.find((c): c is TriggerCapability => c.id === "trigger");
  }

  get triggerManager(): TriggerManager {
    const trigger = this.triggerCapability();
    if (!trigger) throw new Error("trigger capability is not registered");
    return trigger.manager;
  }

  get timerService(): TimerService {
    const trigger = this.triggerCapability();
    if (!trigger) throw new Error("trigger capability is not registered");
    return trigger.timerService;
  }

  deleteSession(agentId: string, sessionId: string): void {
    this.sessionRuntime.destroySession(sessionId);
    this.projectManager.deleteSession(agentId, sessionId);
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.sessionRuntime.evictAgent(agentId);
    for (const capability of this.capabilities) {
      try {
        await capability.onAgentDeleted?.(agentId);
      } catch (err) {
        this.logger.warn({ err, capability: capability.id, agentId }, "onAgentDeleted failed");
      }
    }
    await this.projectManager.deleteAgent(agentId);
  }

  async updateAgentMcp(
    agentId: string,
    config: { servers: ReadonlyArray<Record<string, unknown>> },
  ): Promise<AgentMcpConfig> {
    const result = await this.projectManager.updateAgentMcp(agentId, config);
    for (const capability of this.capabilities) {
      try {
        await capability.invalidateAgent?.(agentId);
      } catch (err) {
        this.logger.warn({ err, capability: capability.id, agentId }, "invalidateAgent failed");
      }
    }
    return result;
  }

  async updateAgent(agentId: string, content: string, themeContent?: string): Promise<AgentProfile> {
    return this.projectManager.updateAgent(agentId, content, themeContent);
  }

  async shutdown(): Promise<void> {
    if (this._shutdownDone) return;
    this._shutdownDone = true;
    this.logger.info({ projectId: this.projectId }, "project runtime shutting down");
    await this.sessionRuntime.closeAll();
    for (const capability of this.capabilities) {
      await capability.shutdown?.();
    }
    this.projectManager.close();
  }
}
