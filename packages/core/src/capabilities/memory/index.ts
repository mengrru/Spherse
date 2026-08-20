import type { Capability } from "../../kernel/capability.js";
import type { KernelServices } from "../../kernel/capability.js";
import type { ContextBlock } from "../../kernel/context-block.js";
import type { StoreRegistry } from "../../kernel/ports.js";
import type { ProjectStore } from "../../store/project.js";
import { MemoryStore, MEMORY_PATH_RULE } from "../../store/memory.js";
import { createMemorySaveTool } from "../../tools/memory-save.js";
import { createMemoryRecallTool } from "../../tools/memory-recall.js";

const RECENT_LIMIT = 20;

function memoryStoreFor(ctx: {
  agentId: string;
  projectStore: ProjectStore;
  stores: StoreRegistry;
}): MemoryStore | undefined {
  const agentStore = ctx.projectStore.getAgent(ctx.agentId);
  if (!agentStore) return undefined;
  const scope = ctx.stores.forAgent(ctx.agentId);
  return (
    scope.get<MemoryStore>("memory") ??
    scope.set("memory", new MemoryStore(agentStore.getAgentDir(), ctx.agentId))
  );
}

export function memoryCapability(): Capability {
  let stores: KernelServices["stores"] | undefined;

  return {
    id: "memory",
    init: async (services) => {
      stores = services.stores;
    },
    pathRules: [MEMORY_PATH_RULE],
    tools: (host) => [
      createMemorySaveTool(() => memoryStoreFor(host)),
      createMemoryRecallTool(() => memoryStoreFor(host)),
    ],
    contextBlocks: async (view) => {
      const store = memoryStoreFor(view);
      if (!store) return [];
      const entries = await store.list();
      if (entries.length === 0) return [];
      const recent = entries.slice(-RECENT_LIMIT);
      const lines = recent.map((e) => `- ${e.content}`);
      const block: ContextBlock = {
        kind: "memory",
        render: () => `<memory>\n${lines.join("\n")}\n</memory>`,
      };
      return [block];
    },
    onAgentDeleted: (agentId) => {
      stores?.clearAgent(agentId);
    },
  };
}
