import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { RECALL_LIMIT } from "../store/memory.js";
import type { MemoryStore, MemoryEntry } from "../store/memory.js";

const MemoryRecallParams = Type.Object({
  query: Type.String({ minLength: 1, description: "Keywords to search for (substring match)" }),
});

function formatEntry(entry: MemoryEntry): string {
  const tags = entry.tags && entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
  return `- (${entry.id})${tags} ${entry.content}`;
}

export function createMemoryRecallTool(
  getStore: () => MemoryStore | undefined,
): AgentTool<typeof MemoryRecallParams> {
  return {
    name: "memory_recall",
    label: "Recall Memory",
    description:
      "Search this agent's long-term memory by keywords (substring match, Chinese supported). Use before answering questions about the user's past statements, preferences, or prior work.",
    parameters: MemoryRecallParams,
    async execute(_toolCallId, params) {
      const store = getStore();
      if (!store) {
        return { content: [{ type: "text" as const, text: "Error: memory store unavailable." }], details: { error: true } };
      }
      const entries = store.search(params.query, RECALL_LIMIT);
      if (entries.length === 0) {
        return {
          content: [
            { type: "text" as const, text: `No memories matching "${params.query}". Total entries: ${store.count()}.` },
          ],
          details: { ids: [] },
        };
      }
      const lines = entries.map(formatEntry);
      return {
        content: [
          {
            type: "text" as const,
            text: `${entries.length} of ${store.count()} entries matching "${params.query}":\n${lines.join("\n")}`,
          },
        ],
        details: { ids: entries.map((e) => e.id) },
      };
    },
  };
}
