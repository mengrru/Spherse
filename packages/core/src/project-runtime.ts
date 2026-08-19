import type { ProjectManager } from "./project-manager.js";
import type { SessionManager } from "./session/session-manager.js";
import type { TriggerManager } from "./trigger/trigger-manager.js";
import type { TimerService } from "./trigger/timer-service.js";
import type { AgentMcpConfig } from "./mcp/index.js";
import type { McpCapability } from "./capabilities/mcp/index.js";
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
  private readonly mcpCapability: McpCapability | undefined;

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
    this.mcpCapability = this.capabilities.find(
      (c): c is McpCapability => c.id === "mcp" && "invalidate" in c,
    );
  }

  get triggerManager(): TriggerManager {
    const trigger = this.capabilities.find((c) => c.id === "trigger") as {
      manager: TriggerManager;
    } | undefined;
    if (!trigger) throw new Error("trigger capability is not registered");
    return trigger.manager;
  }

  get timerService(): TimerService {
    const trigger = this.capabilities.find((c) => c.id === "trigger") as {
      timerService: TimerService;
    } | undefined;
    if (!trigger) throw new Error("trigger capability is not registered");
    return trigger.timerService;
  }

  deleteSession(agentId: string, sessionId: string): void {
    this.sessionRuntime.destroySession(sessionId);
    this.projectManager.deleteSession(agentId, sessionId);
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.sessionRuntime.evictAgent(agentId);
    await this.mcpCapability?.invalidate(agentId);
    for (const capability of this.capabilities) {
      capability.onAgentDeleted?.(agentId);
    }
    await this.projectManager.deleteAgent(agentId);
  }

  async updateAgentMcp(
    agentId: string,
    config: { servers: ReadonlyArray<Record<string, unknown>> },
  ): Promise<AgentMcpConfig> {
    const result = await this.projectManager.updateAgentMcp(agentId, config);
    await this.mcpCapability?.invalidate(agentId);
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
