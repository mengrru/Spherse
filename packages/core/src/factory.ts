import path from "node:path";
import type { SamplingParams, ThinkingLevel } from "./types.js";
import type { ProjectStorageOptions } from "./store/storage-port.js";
import type { MemoryStoreFactory } from "./store/storage-port.js";
import { NodeFsPort } from "./store/node-fs-port.js";
import { builtinToolCapabilities } from "./capabilities/builtin.js";
import { interactionCapability } from "./capabilities/interaction/index.js";
import type { DataStore } from "./capabilities/data/index.js";
import { createTriggerCapability } from "./capabilities/trigger/index.js";
import { createMcpCapability } from "./capabilities/mcp/index.js";
import { attachmentsCapability } from "./capabilities/attachments/index.js";
import { compactionCapability } from "./capabilities/compaction/index.js";
import { memoryCapability } from "./capabilities/memory/index.js";
import { timePerceptionCapability } from "./capabilities/time-perception/index.js";
import type { Capability } from "./kernel/capability.js";
import { ProjectStore } from "./store/project.js";
import { SqliteSessionStore } from "./store/session.js";
import { SqliteMemoryStore } from "./store/memory.js";
import { installSkillZip } from "./store/node-skill-install.js";
import { assembleProjectCore, type AssembleCoreOptions } from "./assemble.js";
import { ProjectRuntime } from "./project-runtime.js";
import type { Logger } from "./logger.js";
import { ModelCatalog } from "./model-providers/catalog.js";

export type { AssembleCoreOptions } from "./assemble.js";
export { assembleProjectCore, defaultCoreCapabilities } from "./assemble.js";

export interface AssembleOptions {
  projectName?: string;
  defaultModel?: string;
  sampling?: SamplingParams;
  thinkingLevel?: ThinkingLevel;
  logger?: Logger;
  modelCatalog?: ModelCatalog;
  capabilities?: Capability[] | ((builtin: Capability[]) => Capability[]);
  storage?: ProjectStorageOptions;
}

export function defaultCapabilities(
  projectStore: ProjectStore,
  logger: Logger,
  dataStore?: DataStore,
): Capability[] {
  return [
    ...builtinToolCapabilities(dataStore, { interaction: interactionCapability() }),
    createTriggerCapability({ projectStore, logger }),
    createMcpCapability({ projectStore, logger }),
    attachmentsCapability(),
    compactionCapability({ logger }),
    timePerceptionCapability(),
    memoryCapability(),
  ];
}

export async function assembleProject(
  projectRoot: string,
  options?: AssembleOptions,
): Promise<ProjectRuntime> {
  const storage: AssembleCoreOptions["storage"] = {
    fsPort: options?.storage?.fsPort ?? new NodeFsPort(projectRoot),
    sessionStoreFactory:
      options?.storage?.sessionStoreFactory ??
      ((ctx) => new SqliteSessionStore(path.join(ctx.agentDir, "sessions.db"), ctx.agentId, ctx.logger, ctx.onSessionChange)),
    memoryStoreFactory:
      options?.storage?.memoryStoreFactory ??
      ((ctx: Parameters<MemoryStoreFactory>[0]) => new SqliteMemoryStore(ctx.agentDir)),
    ...(options?.storage?.installSkillZip ? { installSkillZip: options.storage.installSkillZip } : { installSkillZip }),
  };
  return assembleProjectCore(projectRoot, {
    projectName: options?.projectName,
    interaction: interactionCapability(),
    defaultModel: options?.defaultModel,
    sampling: options?.sampling,
    thinkingLevel: options?.thinkingLevel,
    logger: options?.logger,
    modelCatalog: options?.modelCatalog,
    capabilities: options?.capabilities,
    storage,
  });
}

export type { SessionStoreFactory, MemoryStoreFactory } from "./store/storage-port.js";

export async function createProject(
  projectRoot: string,
  options?: AssembleOptions,
): Promise<ProjectRuntime> {
  return assembleProject(projectRoot, options);
}
