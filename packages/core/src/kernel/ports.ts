import type { ApprovalGate, AskGate } from "./gates.js";
import type { Logger } from "../logger.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import type { ProjectStore } from "../store/project.js";
import type { AgentProfile } from "../types.js";
import type { PathRule } from "../access/path-category.js";

export type SessionEventPayload =
  | { type: string; [key: string]: unknown }
  | { type: string; message: { role?: string; [key: string]: unknown }; [key: string]: unknown };

export interface SessionPort {
  createSession(agentId: string, source?: string): Promise<string>;
  restoreSession(agentId: string, sessionId: string): Promise<string>;
  sendMessage(
    sessionId: string,
    message: string,
    onEvent: (event: SessionEventPayload) => void,
  ): Promise<void>;
  abortSession(sessionId: string): void;
  sessionExists(agentId: string, sessionId: string): boolean;
}

export interface AgentStoreScope {
  get<T = unknown>(name: string): T | undefined;
  set<T>(name: string, store: T): T;
  delete(name: string): void;
  clear(): void;
}

export interface StoreRegistry {
  register(name: string, store: unknown): void;
  get<T = unknown>(name: string): T | undefined;
  forAgent(agentId: string): AgentStoreScope;
  clearAgent(agentId: string): void;
}

export interface KernelServices {
  readonly projectRoot: string;
  readonly metaDir: string;
  readonly logger: Logger;
  readonly fileWriteMutex: FileWriteMutex;
  readonly stores: StoreRegistry;
  readonly session: SessionPort;
}

export interface ToolCatalog {
  names: readonly string[];
}

export interface ToolHost {
  readonly agentId: string;
  readonly sessionId: string;
  readonly profile: AgentProfile;
  readonly projectRoot: string;
  readonly projectStore: ProjectStore;
  readonly fileWriteMutex: FileWriteMutex;
  readonly logger: Logger;
  readonly stores: StoreRegistry;
  readonly pathRules: ReadonlyArray<PathRule>;
  readonly toolCatalog: ToolCatalog;
  readonly approvalGate?: ApprovalGate;
  readonly askGate?: AskGate;
}

export interface SessionView {
  readonly agentId: string;
  readonly profile: AgentProfile;
  readonly projectStore: ProjectStore;
  readonly stores: StoreRegistry;
}

export function createStoreRegistry(logger?: Logger): StoreRegistry {
  const global = new Map<string, unknown>();
  const agentScopes = new Map<string, Map<string, unknown>>();
  const log = logger;

  const scopeFor = (agentId: string): Map<string, unknown> => {
    let scope = agentScopes.get(agentId);
    if (!scope) {
      scope = new Map();
      agentScopes.set(agentId, scope);
    }
    return scope;
  };

  const asScope = (agentId: string): AgentStoreScope => ({
    get: <T>(name: string) => scopeFor(agentId).get(name) as T | undefined,
    set: <T>(name: string, store: T): T => {
      scopeFor(agentId).set(name, store);
      return store;
    },
    delete: (name: string) => {
      scopeFor(agentId).delete(name);
    },
    clear: () => {
      agentScopes.delete(agentId);
    },
  });

  return {
    register: (name, store) => {
      if (global.has(name)) {
        log?.warn({ store: name }, "global store name registered twice, overwriting");
      }
      global.set(name, store);
    },
    get: <T>(name: string) => global.get(name) as T | undefined,
    forAgent: asScope,
    clearAgent: (agentId) => {
      agentScopes.delete(agentId);
    },
  };
}
