import * as paths from "./utils/paths.js";
import { PROJECT_META_DIR } from "./types.js";
import type { SamplingParams, ThinkingLevel } from "./types.js";
import { FileWriteMutex } from "./utils/file-write-mutex.js";
import type { FsPort } from "./store/fs-port.js";
import type { SessionStoreFactory, MemoryStoreFactory } from "./store/storage-port.js";
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
import { createHostContext, type HostFiber } from "./host/context.js";
import { registerCoreServices, registerRuntimeServices } from "./host/services.js";
import { defineCapabilityPlugin } from "./host/capability-plugin.js";
import { createCapabilityContributions } from "./host/contributions.js";
import type { PluginLoadReport } from "./plugins/loader.js";

export interface AssembleCoreOptions {
  projectName?: string;
  defaultModel?: string;
  sampling?: SamplingParams;
  thinkingLevel?: ThinkingLevel;
  logger?: Logger;
  modelCatalog?: ModelCatalog;
  capabilities?: Capability[] | ((builtin: Capability[]) => Capability[]);
  interaction?: Capability;
  pluginLoadReport?: PluginLoadReport;
  storage: {
    fsPort: FsPort;
    sessionStoreFactory: SessionStoreFactory;
    memoryStoreFactory: MemoryStoreFactory;
  };
}

export function defaultCoreCapabilities(
  projectStore: ProjectStore,
  logger: Logger,
  dataStore?: DataStore,
  interaction?: Capability,
): Capability[] {
  return [
    ...builtinToolCapabilities(dataStore, interaction ? { interaction } : {}),
    createTriggerCapability({ projectStore, logger }),
    createMcpCapability({ projectStore, logger }),
    attachmentsCapability(),
    compactionCapability({ logger }),
    timePerceptionCapability(),
    memoryCapability(),
  ];
}

export async function assembleProjectCore(
  projectRoot: string,
  options: AssembleCoreOptions,
): Promise<ProjectRuntime> {
  const logger = options.logger ?? createSilentLogger();

  const fileWriteMutex = new FileWriteMutex();
  const fsPort = options.storage.fsPort;
  const projectStore = new ProjectStore(projectRoot, options.storage, logger, fileWriteMutex);
  const dataStore = createDataStore({ projectRoot, fsPort: projectStore.getFsPort(), fileWriteMutex, logger });

  let isNewProject = false;
  try {
    await projectStore.open();
  } catch (err) {
    if (!(err instanceof ProjectConfigNotFoundError)) {
      throw err;
    }
    isNewProject = true;
    const dirName = paths.basename(paths.resolve(projectRoot));
    await projectStore.create(options.projectName ?? dirName);
  }

  if (isNewProject) {
    await initPresets(projectStore, fsPort, logger);
  }

  const projectManager = new ProjectManager(projectStore, logger, fileWriteMutex, fsPort);
  const stores = createStoreRegistry(logger);
  const capabilities =
    typeof options.capabilities === "function"
      ? options.capabilities(defaultCoreCapabilities(projectStore, logger, dataStore, options.interaction))
      : (options.capabilities ?? defaultCoreCapabilities(projectStore, logger, dataStore, options.interaction));

  const host = createHostContext();
  const contributions = createCapabilityContributions();
  registerCoreServices(host, {
    fs: fsPort,
    logger,
    fileWriteMutex,
    projectStore,
    stores,
    data: dataStore,
    sessionStoreFactory: options.storage.sessionStoreFactory,
    memoryStoreFactory: options.storage.memoryStoreFactory,
    capabilities: contributions,
  });

  const runConfig = new RunConfigHolder({
    ...(options.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
    ...(options.sampling !== undefined ? { sampling: options.sampling } : {}),
    ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
  });
  const deps = createRuntimeDeps({
    projectStore,
    logger,
    fileWriteMutex,
    modelCatalog: options.modelCatalog,
    capabilities: contributions.snapshot,
    stores,
    runConfig,
  });

  const sessionRuntime = new SessionManager(deps, { initialRunConfig: runConfig });
  registerRuntimeServices(host, { sessionManager: sessionRuntime, projectManager: projectManager });

  const sessionPort: SessionPort = {
    createSession: (agentId, source) => sessionRuntime.createSession(agentId, source),
    restoreSession: (agentId, sessionId) => sessionRuntime.restoreSession(agentId, sessionId),
    sendMessage: (sessionId, message, onEvent, meta) =>
      sessionRuntime.sendMessage(sessionId, message, [], onEvent as never, meta),
    abortSession: (sessionId) => sessionRuntime.abortSession(sessionId),
    sessionExists: (agentId, sessionId) => sessionRuntime.sessionExists(agentId, sessionId),
  };

  const kernelServices = {
    projectRoot: projectStore.getRootPath(),
    metaDir: paths.join(projectStore.getRootPath(), PROJECT_META_DIR),
    logger,
    fileWriteMutex,
    stores,
    session: sessionPort,
  };

  const pluginWrappers = capabilities.map((capability) =>
    defineCapabilityPlugin(capability, kernelServices, contributions),
  );
  const fibers: HostFiber[] = [];
  const capabilityEntries = new Map<string, Array<{ fiber: HostFiber; capability: Capability }>>();
  try {
    for (const wrapper of pluginWrappers) {
      const fiber = host.plugin(wrapper.plugin);
      wrapper.fiber = fiber;
      fibers.push(fiber);
      await wrapper.ready;
    }
  } catch (err) {
    for (const fiber of fibers) {
      try {
        await fiber.dispose();
      } catch {
        /* fiber state hygiene only */
      }
    }
    throw err;
  }
  for (let i = 0; i < capabilities.length; i++) {
    const entry = { fiber: fibers[i]!, capability: capabilities[i]! };
    const existing = capabilityEntries.get(entry.capability.id);
    if (existing) existing.push(entry);
    else capabilityEntries.set(entry.capability.id, [entry]);
  }

  return new ProjectRuntime({
    projectManager,
    sessionRuntime,
    projectId: projectStore.config.getProjectId(),
    logger,
    capabilities,
    dataStore,
    host,
    hostFibers: fibers,
    capabilityEntries,
    kernelServices,
    contributions,
    pluginLoadReport: options.pluginLoadReport,
  });
}

export type { ProjectStorageOptions } from "./store/storage-port.js";
