import path from "node:path";
import { PROJECT_META_DIR } from "./types.js";
import type { SamplingParams, ThinkingLevel } from "./types.js";
import { FileWriteMutex } from "./utils/file-write-mutex.js";
import { ProjectStore } from "./store/project.js";
import { ProjectManager } from "./project-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { RunConfigHolder, createRuntimeDeps } from "./session/runtime.js";
import { builtinToolCapabilities } from "./capabilities/builtin.js";
import { createDataStore } from "./capabilities/data/index.js";
import type { DataStore } from "./capabilities/data/index.js";
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
import { ProjectConfigNotFoundError } from "./errors.js";
import { ModelCatalog } from "./model-providers/catalog.js";

export interface AssembleOptions {
  projectName?: string;
  defaultModel?: string;
  sampling?: SamplingParams;
  thinkingLevel?: ThinkingLevel;
  logger?: Logger;
  modelCatalog?: ModelCatalog;
  capabilities?: Capability[] | ((builtin: Capability[]) => Capability[]);
  wrapSessionPort?: (port: SessionPort) => SessionPort;
}

export function defaultCapabilities(
  projectStore: ProjectStore,
  logger: Logger,
  dataStore?: DataStore,
): Capability[] {
  return [
    ...builtinToolCapabilities(dataStore),
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
  const logger = options?.logger ?? createSilentLogger();

  const fileWriteMutex = new FileWriteMutex();
  const projectStore = new ProjectStore(projectRoot, logger, fileWriteMutex);
  const dataStore = createDataStore({ projectRoot, fileWriteMutex, logger });

  let isNewProject = false;
  try {
    await projectStore.open();
  } catch (err) {
    if (!(err instanceof ProjectConfigNotFoundError)) {
      throw err;
    }
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
      ? options.capabilities(defaultCapabilities(projectStore, logger, dataStore))
      : (options?.capabilities ?? defaultCapabilities(projectStore, logger, dataStore));

  const runConfig = new RunConfigHolder({
    ...(options?.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
    ...(options?.sampling !== undefined ? { sampling: options.sampling } : {}),
    ...(options?.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
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

  let sessionPort: SessionPort = {
    createSession: (agentId, source) => sessionRuntime.createSession(agentId, source),
    restoreSession: (agentId, sessionId) => sessionRuntime.restoreSession(agentId, sessionId),
    sendMessage: (sessionId, message, onEvent, meta) =>
      sessionRuntime.sendMessage(sessionId, message, [], onEvent as never, meta),
    abortSession: (sessionId) => sessionRuntime.abortSession(sessionId),
    sessionExists: (agentId, sessionId) => sessionRuntime.sessionExists(agentId, sessionId),
  };
  if (options?.wrapSessionPort) {
    sessionPort = options.wrapSessionPort(sessionPort);
  }

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
    dataStore,
  });
}

export async function createProject(
  projectRoot: string,
  options?: AssembleOptions,
): Promise<ProjectRuntime> {
  return assembleProject(projectRoot, options);
}
