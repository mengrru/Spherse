import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryStore } from "../store/memory.js";

const MemoryRecallParams = Type.Object({
  query: Type.String({ description: "Keyword or tag to search memories with. Empty query lists all." }),
});

export function createMemoryRecallTool(
  getStore: () => MemoryStore | undefined,
): AgentTool<typeof MemoryRecallParams> {
  return {
    name: "memory_recall",
    label: "Recall Memory",
    description:
      "Search this agent's private memory by keyword or tag. Returns matching entries, most recent last.",
    parameters: MemoryRecallParams,
    async execute(_toolCallId, params) {
      const store = getStore();
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
