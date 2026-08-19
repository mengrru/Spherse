import path from "node:path";
import { PROJECT_META_DIR } from "./types.js";
import type { SamplingParams } from "./types.js";
import { FileWriteMutex } from "./utils/file-write-mutex.js";
import { ProjectStore } from "./store/project.js";
import { ProjectManager } from "./project-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { RunConfigHolder, createRuntimeDeps } from "./session/runtime.js";
import { builtinToolCapabilities } from "./capabilities/builtin.js";
import { createTriggerCapability } from "./capabilities/trigger/index.js";
import { createMcpCapability } from "./capabilities/mcp/index.js";
import { attachmentsCapability } from "./capabilities/attachments/index.js";
import { compactionCapability } from "./capabilities/compaction/index.js";
import { memoryCapability } from "./capabilities/memory/index.js";
import { timePerceptionCapability } from "./capabilities/time-perception/index.js";
import { createStoreRegistry, type SessionPort } from "./kernel/ports.js";
import type { Capability } from "./kernel/capability.js";
import { ProjectRuntime } from "./project-runtime.js";
import { initPresets } from "./presets.js";
import { type Logger, createSilentLogger } from "./logger.js";
import { ModelCatalog } from "./model-providers/catalog.js";

export interface AssembleOptions {
  projectName?: string;
  defaultModel?: string;
  sampling?: SamplingParams;
  logger?: Logger;
  modelCatalog?: ModelCatalog;
  capabilities?: Capability[] | ((builtin: Capability[]) => Capability[]);
}

export function defaultCapabilities(projectStore: ProjectStore, logger: Logger): Capability[] {
  return [
    ...builtinToolCapabilities(),
    createTriggerCapability({ projectStore, logger }),
    createMcpCapability({ projectStore, logger }),
    attachmentsCapability(),
    compactionCapability({ projectStore, logger }),
    timePerceptionCapability(),
    memoryCapability(),
  ];
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
  const capabilities =
    typeof options?.capabilities === "function"
      ? options.capabilities(defaultCapabilities(projectStore, logger))
      : (options?.capabilities ?? defaultCapabilities(projectStore, logger));

  const runConfig = new RunConfigHolder({
    ...(options?.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
    ...(options?.sampling !== undefined ? { sampling: options.sampling } : {}),
  });
  const deps = createRuntimeDeps({
    projectStore,
    logger,
    fileWriteMutex,
    modelCatalog: options?.modelCatalog,
    capabilities,
    stores,
    runConfig,
  });

  const sessionRuntime = new SessionManager(deps, { initialRunConfig: runConfig });

  const sessionPort: SessionPort = {
    createSession: (agentId, source) => sessionRuntime.createSession(agentId, source),
    restoreSession: (agentId, sessionId) => sessionRuntime.restoreSession(agentId, sessionId),
    sendMessage: (sessionId, message, onEvent) =>
      sessionRuntime.sendMessage(sessionId, message, [], onEvent as never),
    abortSession: (sessionId) => sessionRuntime.abortSession(sessionId),
    sessionExists: (agentId, sessionId) => sessionRuntime.sessionExists(agentId, sessionId),
  };

  for (const capability of capabilities) {
    if (!capability.init) continue;
    await capability.init({
      projectRoot: projectStore.getRootPath(),
      metaDir: path.join(projectStore.getRootPath(), PROJECT_META_DIR),
      logger,
      fileWriteMutex,
      stores,
      session: sessionPort,
    });
  }

  return new ProjectRuntime({
    projectManager,
    sessionRuntime,
    projectId: projectStore.config.getProjectId(),
    logger,
    capabilities,
  });
}

export async function createProject(
  projectRoot: string,
  options?: AssembleOptions,
): Promise<ProjectRuntime> {
  return assembleProject(projectRoot, options);
}
