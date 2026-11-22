import { Context } from "cordis";

export type HostContext = Context;
export type HostFiber = ReturnType<HostContext["plugin"]>;

export const HostServiceKey = {
  fs: "spherse/fs",
  logger: "spherse/logger",
  fileWriteMutex: "spherse/file-write-mutex",
  projectStore: "spherse/project-store",
  stores: "spherse/stores",
  data: "spherse/data",
  sessionStoreFactory: "spherse/session-store-factory",
  memoryStoreFactory: "spherse/memory-store-factory",
  capabilities: "spherse/capabilities",
} as const;

export function createHostContext(): HostContext {
  return new Context();
}
