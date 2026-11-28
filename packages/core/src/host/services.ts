import type { Logger } from "../logger.js";
import type { FsPort } from "../store/fs-port.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import type { ProjectStore } from "../store/project.js";
import type { DataStore } from "../capabilities/data/index.js";
import type { StoreRegistry } from "../kernel/ports.js";
import type { SessionStoreFactory, MemoryStoreFactory } from "../store/storage-port.js";
import type { CapabilityContributions } from "./contributions.js";
import { HostServiceKey } from "./context.js";
import type { HostContext } from "./context.js";

export interface HostCoreServices {
  fs: FsPort;
  logger: Logger;
  fileWriteMutex: FileWriteMutex;
  projectStore: ProjectStore;
  stores: StoreRegistry;
  data?: DataStore;
  sessionStoreFactory: SessionStoreFactory;
  memoryStoreFactory: MemoryStoreFactory;
  capabilities: CapabilityContributions;
}

export function registerCoreServices(host: HostContext, services: HostCoreServices): void {
  host.provide(HostServiceKey.fs, services.fs);
  host.provide(HostServiceKey.logger, services.logger);
  host.provide(HostServiceKey.fileWriteMutex, services.fileWriteMutex);
  host.provide(HostServiceKey.projectStore, services.projectStore);
  host.provide(HostServiceKey.stores, services.stores);
  if (services.data !== undefined) {
    host.provide(HostServiceKey.data, services.data);
  }
  host.provide(HostServiceKey.sessionStoreFactory, services.sessionStoreFactory);
  host.provide(HostServiceKey.memoryStoreFactory, services.memoryStoreFactory);
  host.provide(HostServiceKey.capabilities, services.capabilities);
}

export interface HostRuntimeServices {
  sessionManager: import("../session/session-manager.js").SessionManager;
  projectManager: import("../project-manager.js").ProjectManager;
}

export function registerRuntimeServices(host: HostContext, services: HostRuntimeServices): void {
  host.provide(HostServiceKey.session, services.sessionManager);
  host.provide(HostServiceKey.pm, services.projectManager);
}
