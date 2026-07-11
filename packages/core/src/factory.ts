import path from "node:path";
import { PROJECT_META_DIR } from "./types.js";
import { ProjectStore } from "./store/project.js";
import { ProjectManager } from "./project-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { TriggerManager } from "./trigger/trigger-manager.js";
import { TimerService } from "./trigger/timer-service.js";
import { ProjectRuntime } from "./project-runtime.js";
import { initPresets } from "./presets.js";
import { type Logger, createSilentLogger } from "./logger.js";

export async function createProject(
  projectRoot: string,
  options?: {
    projectName?: string;
    defaultModel?: string;
    temperature?: number;
    logger?: Logger;
  },
): Promise<ProjectRuntime> {
  const logger = options?.logger ?? createSilentLogger();

  const projectStore = new ProjectStore(projectRoot, logger);

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

  const projectManager = new ProjectManager(projectStore, logger);
  const sessionRuntime = new SessionManager(projectStore, {
    defaultModel: options?.defaultModel,
    temperature: options?.temperature,
    logger,
  });
  const triggerManager = new TriggerManager({ sessionRuntime, projectStore, logger });
  const timerService = new TimerService(() => triggerManager.onTimeTick(), logger);
  timerService.start();

  return new ProjectRuntime({
    projectManager,
    sessionRuntime,
    triggerManager,
    timerService,
    projectId: projectStore.config.getProjectId(),
    logger,
  });
}
