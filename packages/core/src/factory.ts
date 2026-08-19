import path from "node:path";
import { PROJECT_META_DIR } from "./types.js";
import type { SamplingParams } from "./types.js";
import { FileWriteMutex } from "./utils/file-write-mutex.js";
import { ProjectStore } from "./store/project.js";
import { ProjectManager } from "./project-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { RunConfigHolder, createRuntimeDeps } from "./session/runtime.js";
import { createTriggerCapability, type TriggerCapability } from "./capabilities/trigger/index.js";
import { createMcpCapability, type McpCapability } from "./capabilities/mcp/index.js";
import { builtinToolCapabilities } from "./capabilities/builtin.js";
import { attachmentsCapability } from "./capabilities/attachments/index.js";
import { compactionCapability } from "./capabilities/compaction/index.js";
import { memoryCapability } from "./capabilities/memory/index.js";
import type { SessionPort } from "./kernel/ports.js";
import { createStoreRegistry } from "./kernel/ports.js";
import { ProjectRuntime } from "./project-runtime.js";
import { initPresets } from "./presets.js";
import { type Logger, createSilentLogger } from "./logger.js";

export interface AssembleOptions {
  projectName?: string;
  defaultModel?: string;
  sampling?: SamplingParams;
  logger?: Logger;
}

export async function assembleProject(
  projectRoot: string,
  options?: AssembleOptions,
): Promise<ProjectRuntime> {
  const logger = options?.logger ?? createSilentLogger();

  const fileWriteMutex = new FileWriteMutex();
  const projectStore = new ProjectStore(projectRoot, logger, fileWriteMutex);

  let isNewProject = false;
  try {
    await projectStore.open();
  } catch {
    isNewProject = true;
    const dirName = path.basename(path.resolve(projectRoot));
    await projectStore.create(options?.projectName ?? dirName);
  }

  if (isNewProject) {
    const spherseDir = path.join(projectRoot, PROJECT_META_DIR);
    await initPresets(projectStore, spherseDir, logger);
  }

  const projectManager = new ProjectManager(projectStore, logger, fileWriteMutex);
  const stores = createStoreRegistry(logger);

  const mcpCapability = createMcpCapability({
    logger,
    loadServers: async (agentId) => {
      const agentStore = projectStore.getAgent(agentId);
      if (!agentStore) return [];
      try {
        return (await agentStore.mcp.getConfig()).servers;
      } catch (err) {
        logger.warn({ err, agentId }, "failed to load agent mcp config");
        return [];
      }
    },
  });

  const sessionRuntimeRef: { current?: SessionManager } = {};
  const sessionPort: SessionPort = {
    createSession: (agentId, source) => sessionRuntimeRef.current!.createSession(agentId, source),
    restoreSession: (agentId, sessionId) => sessionRuntimeRef.current!.restoreSession(agentId, sessionId),
    sendMessage: (sessionId, message, onEvent) =>
      sessionRuntimeRef.current!.sendMessage(sessionId, message, [], onEvent as never),
    sessionExists: (agentId, sessionId) => sessionRuntimeRef.current!.sessionExists(agentId, sessionId),
  };

  const triggerCapability = createTriggerCapability({
    projectStore,
    getSessionPort: () => sessionPort,
    logger,
  });

  const runConfig = new RunConfigHolder({
    ...(options?.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
    ...(options?.sampling !== undefined ? { sampling: options.sampling } : {}),
  });
  const deps = createRuntimeDeps({
    projectStore,
    logger,
    fileWriteMutex,
    capabilities: [
      ...builtinToolCapabilities(),
      triggerCapability,
      mcpCapability,
      attachmentsCapability(),
      compactionCapability({ projectStore, logger }),
      memoryCapability(),
    ],
    stores,
    runConfig,
  });

  const sessionRuntime = new SessionManager(deps, { initialRunConfig: runConfig });
  sessionRuntimeRef.current = sessionRuntime;

  return new ProjectRuntime({
    projectManager,
    sessionRuntime,
    projectId: projectStore.config.getProjectId(),
    logger,
    capabilities: deps.capabilities,
  });
}

export async function createProject(
  projectRoot: string,
  options?: AssembleOptions,
): Promise<ProjectRuntime> {
  return assembleProject(projectRoot, options);
}

export type { TriggerCapability, McpCapability };
