import type { ProjectStore } from "../store/project.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import type { Logger } from "../logger.js";

export interface SessionContext {
  projectStore: ProjectStore;
  projectRoot: string;
  fileWriteMutex: FileWriteMutex;
  logger: Logger;
  defaultModel?: string;
  temperature?: number;
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
