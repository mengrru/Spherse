import type { Logger } from "../logger.js";
import type { SessionChangePayload, SessionStorePort } from "./session.js";
import type { MemoryStorePort } from "./memory.js";
import type { FsPort } from "./fs-port.js";

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
  fsPort: FsPort;
}

export type MemoryStoreFactory = (context: MemoryStoreFactoryContext) => MemoryStorePort;

export interface ProjectStorageOptions {
  fsPort?: FsPort;
  sessionStoreFactory?: SessionStoreFactory;
  memoryStoreFactory?: MemoryStoreFactory;
}
