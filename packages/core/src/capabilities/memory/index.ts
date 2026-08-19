import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolHost } from "../../kernel/ports.js";
import type { Capability, KernelServices } from "../../kernel/capability.js";
import type { ContextBlock } from "../../kernel/context-block.js";
import { MemoryStore, MEMORY_PATH_RULE, memoryStoreOf } from "./store.js";

const MemorySaveParams = Type.Object({
  content: Type.String({ description: "The fact or knowledge to remember for this agent" }),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags for later recall" })),
});

const MemoryRecallParams = Type.Object({
  query: Type.String({ description: "Keyword or tag to search memories with. Empty query lists all." }),
});

interface MemoryCapabilityState {
  stores?: KernelServices["stores"];
}

function storeFor(host: ToolHost): MemoryStore | undefined {
  const agentStore = host.projectStore.getAgent(host.agentId);
  if (!agentStore) return undefined;
  const scope = host.stores.forAgent(host.agentId);
  return scope.get<MemoryStore>("memory") ?? scope.set("memory", memoryStoreOf(agentStore.getAgentDir(), host.agentId));
}

function createMemorySaveTool(host: ToolHost): AgentTool<typeof MemorySaveParams> {
  return {
    name: "memory_save",
    label: "Save Memory",
    description:
      "Persist a durable fact to this agent's private memory. Saved entries are injected into future sessions.",
    parameters: MemorySaveParams,
    async execute(_toolCallId, params) {
      const store = storeFor(host);
      if (!store) {
        return {
          content: [{ type: "text" as const, text: "Error: agent store unavailable." }],
          details: { error: true },
        };
      }
      const entry = await store.save(params.content, params.tags);
      return {
        content: [{ type: "text" as const, text: `Memory saved (${entry.id}).` }],
        details: { id: entry.id, tags: entry.tags },
      };
    },
  };
}

function createMemoryRecallTool(host: ToolHost): AgentTool<typeof MemoryRecallParams> {
  return {
    name: "memory_recall",
    label: "Recall Memory",
    description:
      "Search this agent's private memory by keyword or tag. Returns matching entries, most recent last.",
    parameters: MemoryRecallParams,
    async execute(_toolCallId, params) {
      const store = storeFor(host);
      if (!store) {
        return {
          content: [{ type: "text" as const, text: "Error: agent store unavailable." }],
          details: { count: 0 },
        };
      }
      const entries = await store.recall(params.query);
      if (entries.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No matching memories." }],
          details: { count: 0 },
        };
      }
      const lines = entries.map((e) => `- ${e.content}`);
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { count: entries.length },
      };
    },
  };
}

const RECENT_LIMIT = 20;

export function memoryCapability(): Capability {
  const state: MemoryCapabilityState = {};

  return {
    id: "memory",
    init: async (services) => {
      state.stores = services.stores;
    },
    pathRules: [MEMORY_PATH_RULE],
    tools: (host) => [createMemorySaveTool(host), createMemoryRecallTool(host)],
    contextBlocks: async (view) => {
      const agentStore = view.projectStore.getAgent(view.agentId);
      if (!agentStore) return [];
      const scope = view.stores.forAgent(view.agentId);
      const store =
        scope.get<MemoryStore>("memory") ??
        scope.set("memory", memoryStoreOf(agentStore.getAgentDir(), view.agentId));
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
      state.stores?.clearAgent(agentId);
    },
  };
}
