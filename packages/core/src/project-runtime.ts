import type { ProjectManager } from "./project-manager.js";
import type { SessionManager } from "./session/session-manager.js";
import type { TriggerManager } from "./trigger/trigger-manager.js";
import type { TimerService } from "./trigger/timer-service.js";
import type { AgentMcpConfig } from "./mcp/index.js";
import type { MemoryEntry, MemoryEntryPatch } from "./store/memory-port.js";
import type { TriggerCapability } from "./capabilities/trigger/index.js";
import type { DataStore } from "./capabilities/data/index.js";
import type { AgentConfigChangeKind, Capability } from "./kernel/capability.js";
import type { AgentProfile } from "./types.js";
import { type Logger, createSilentLogger } from "./logger.js";
import { settleWithin } from "./utils/settle-within.js";
import { createHostContext } from "./host/context.js";
import type { PluginLoadReport } from "./plugins/loader.js";
import type { HostContext, HostFiber } from "./host/context.js";
import type { CapabilityContributions } from "./host/contributions.js";
import { defineCapabilityPlugin } from "./host/capability-plugin.js";
import type { KernelServices } from "./kernel/ports.js";

const CAPABILITY_SHUTDOWN_TIMEOUT_MS = 5_000;

export class ProjectRuntime {
  readonly projectManager: ProjectManager;
  readonly sessionRuntime: SessionManager;
  readonly projectId: string;
  readonly dataStore: DataStore | undefined;
  readonly host: HostContext;
  private logger: Logger;
  private _shutdownDone = false;
  private readonly contributions: CapabilityContributions;
  private readonly hostFibers: ReadonlyArray<HostFiber>;
  private readonly capabilityEntries: Map<string, Array<{ fiber: HostFiber; capability: Capability }>>;
  private readonly kernelServices: KernelServices | undefined;
  readonly pluginLoadReport?: PluginLoadReport;

  constructor(deps: {
    projectManager: ProjectManager;
    sessionRuntime: SessionManager;
    projectId: string;
    logger?: Logger;
    capabilities: ReadonlyArray<Capability>;
    dataStore?: DataStore;
    host?: HostContext;
    hostFibers?: ReadonlyArray<HostFiber>;
    capabilityEntries?: Map<string, Array<{ fiber: HostFiber; capability: Capability }>>;
    kernelServices?: KernelServices;
    contributions?: CapabilityContributions;
    pluginLoadReport?: PluginLoadReport;
  }) {
    this.projectManager = deps.projectManager;
    this.sessionRuntime = deps.sessionRuntime;
    this.projectId = deps.projectId;
    this.dataStore = deps.dataStore;
    this.logger = deps.logger ?? createSilentLogger();
    this.contributions = deps.contributions ?? createFixedContributions(deps.capabilities);
    this.host = deps.host ?? createHostContext();
    this.hostFibers = deps.hostFibers ?? [];
    this.capabilityEntries = deps.capabilityEntries ?? new Map();
    this.kernelServices = deps.kernelServices;
    this.pluginLoadReport = deps.pluginLoadReport;
  }

  get capabilities(): ReadonlyArray<Capability> {
    return this.contributions.snapshot();
  }

  private triggerCapability(): TriggerCapability | undefined {
    return this.contributions.snapshot().find((c): c is TriggerCapability => c.id === "trigger");
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
    for (const capability of this.contributions.snapshot()) {
      try {
        await capability.onAgentDeleted?.(agentId);
      } catch (err) {
        this.logger.warn({ err, capability: capability.id, agentId }, "onAgentDeleted failed");
      }
    }
    await this.projectManager.deleteAgent(agentId);
  }

  async dispatchAgentConfigChanged(
    agentId: string,
    kind: AgentConfigChangeKind,
  ): Promise<void> {
    for (const capability of this.contributions.snapshot()) {
      try {
        await capability.onAgentConfigChanged?.(agentId, kind);
      } catch (err) {
        this.logger.warn({ err, capability: capability.id, agentId, kind }, "onAgentConfigChanged failed");
      }
    }
  }

  async updateAgentMcp(
    agentId: string,
    config: { servers: ReadonlyArray<Record<string, unknown>> },
  ): Promise<AgentMcpConfig> {
    const result = await this.projectManager.updateAgentMcp(agentId, config);
    await this.dispatchAgentConfigChanged(agentId, "mcp");
    return result;
  }

  async getAgentMemory(agentId: string): Promise<{ enabled: boolean; core: string; coreLimit: number }> {
    return this.projectManager.getAgentMemory(agentId);
  }

  async updateAgentMemory(
    agentId: string,
    input: { enabled?: boolean; core?: string },
  ): Promise<{ enabled: boolean; core: string; coreLimit: number }> {
    return this.projectManager.updateAgentMemory(agentId, input);
  }

  listAgentMemoryEntries(agentId: string, query?: string): MemoryEntry[] {
    return this.projectManager.listAgentMemoryEntries(agentId, query);
  }

  updateAgentMemoryEntry(agentId: string, entryId: string, patch: MemoryEntryPatch): MemoryEntry {
    return this.projectManager.updateAgentMemoryEntry(agentId, entryId, patch);
  }

  deleteAgentMemoryEntry(agentId: string, entryId: string): void {
    this.projectManager.deleteAgentMemoryEntry(agentId, entryId);
  }

  async updateAgent(agentId: string, content: string, themeContent?: string): Promise<AgentProfile> {
    return this.projectManager.updateAgent(agentId, content, themeContent);
  }

  async shutdown(): Promise<void> {
    if (this._shutdownDone) return;
    this._shutdownDone = true;
    this.logger.info({ projectId: this.projectId }, "project runtime shutting down");
    await this.sessionRuntime.closeAll();
    for (const capability of this.contributions.snapshot()) {
      await settleWithin(
        capability.shutdown?.(),
        CAPABILITY_SHUTDOWN_TIMEOUT_MS,
        (outcome, detail) => {
          this.logger.warn(
            {
              projectId: this.projectId,
              capability: capability.id,
              outcome,
              err: outcome === "error" ? detail : undefined,
              timeoutMs: CAPABILITY_SHUTDOWN_TIMEOUT_MS,
            },
            "capability shutdown did not complete, continuing",
          );
        },
      );
    }
    this.projectManager.close();
    for (const fiber of this.hostFibers) {
      try {
        await fiber.dispose();
      } catch {
        /* fiber state hygiene only */
      }
    }
    for (const entries of this.capabilityEntries.values()) {
      for (const { fiber } of entries) {
        try {
          await fiber.dispose();
        } catch {
          /* fiber state hygiene only */
        }
      }
    }
  }

  async loadCapability(capability: Capability): Promise<void> {
    if (this._shutdownDone) throw new Error("runtime is shutting down");
    if (this.contributions.has(capability.id)) {
      throw new Error(`capability id already loaded: ${capability.id}`);
    }
    if (!this.kernelServices) throw new Error("runtime was assembled without kernelServices");
    const wrapper = defineCapabilityPlugin(capability, this.kernelServices, this.contributions);
    const fiber = this.host.plugin(wrapper.plugin);
    wrapper.fiber = fiber;
    try {
      await wrapper.ready;
    } catch (err) {
      try {
        await fiber.dispose();
      } catch {
        /* fiber state hygiene only */
      }
      throw err;
    }
    const entries = this.capabilityEntries.get(capability.id) ?? [];
    entries.push({ fiber, capability });
    this.capabilityEntries.set(capability.id, entries);
  }

  async unloadCapability(id: string): Promise<boolean> {
    const entries = this.capabilityEntries.get(id);
    if (!entries || entries.length === 0) return false;
    for (const { fiber, capability } of [...entries]) {
      try {
        await fiber.dispose();
      } catch {
        /* fiber state hygiene only */
      }
      await settleWithin(
        capability.shutdown?.(),
        CAPABILITY_SHUTDOWN_TIMEOUT_MS,
        (outcome, detail) => {
          this.logger.warn(
            {
              projectId: this.projectId,
              capability: capability.id,
              outcome,
              err: outcome === "error" ? detail : undefined,
              timeoutMs: CAPABILITY_SHUTDOWN_TIMEOUT_MS,
            },
            "capability shutdown did not complete, continuing",
          );
        },
      );
    }
    this.capabilityEntries.delete(id);
    return true;
  }
}

function createFixedContributions(capabilities: ReadonlyArray<Capability>): CapabilityContributions {
  const frozen = Object.freeze([...capabilities]);
  return {
    snapshot: () => frozen,
    push: () => {},
    pull: () => {},
    has: (id) => frozen.some((c) => c.id === id),
  };
}
