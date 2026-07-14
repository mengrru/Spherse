import type { ProjectStore } from "../store/project.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import type { TriggerManager } from "../trigger/trigger-manager.js";
import type { Logger } from "../logger.js";
import type { SamplingParams } from "../types.js";

export interface SessionContext {
  projectStore: ProjectStore;
  projectRoot: string;
  fileWriteMutex: FileWriteMutex;
  logger: Logger;
  defaultModel?: string;
  sampling?: SamplingParams;
  triggerManager?: TriggerManager;
}

export interface TurnContextSnapshot {
  sessionId: string;
  capturedAt: string;
  systemPrompt: string;
  messages: unknown[];
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
}
