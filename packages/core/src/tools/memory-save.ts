import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryStore } from "../store/memory.js";

const MemorySaveParams = Type.Object({
  content: Type.String({ description: "The fact or knowledge to remember for this agent" }),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags for later recall" })),
});

export function createMemorySaveTool(
  getStore: () => MemoryStore | undefined,
): AgentTool<typeof MemorySaveParams> {
  return {
    name: "memory_save",
    label: "Save Memory",
    description:
      "Persist a durable fact to this agent's private memory. Saved entries are injected into future sessions.",
    parameters: MemorySaveParams,
    async execute(_toolCallId, params) {
      const store = getStore();
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
