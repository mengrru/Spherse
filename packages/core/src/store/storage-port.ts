import type { Logger } from "../logger.js";
import type { SessionChangePayload, SessionStorePort } from "./session.js";
import type { MemoryStorePort } from "./memory.js";

export interface SessionStoreFactoryContext {
  agentId: string;
  agentDir: string;
  logger: Logger;
  onSessionChange?: (payload: SessionChangePayload) => void;
}

export type SessionStoreFactory = (context: SessionStoreFactoryContext) => SessionStorePort;

export interface MemoryStoreFactoryContext {
  agentDir: string;
  logger: Logger;
}

export type MemoryStoreFactory = (context: MemoryStoreFactoryContext) => MemoryStorePort;

export interface ProjectStorageOptions {
  sessionStoreFactory?: SessionStoreFactory;
  memoryStoreFactory?: MemoryStoreFactory;
}
