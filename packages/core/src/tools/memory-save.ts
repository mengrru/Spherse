import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryStore } from "../store/memory.js";

const MemorySaveParams = Type.Object({
  content: Type.String({
    description: "A short, self-contained fact to remember across sessions",
  }),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: "Optional retrieval tags (max 8)" }),
  ),
});

export function createMemorySaveTool(
  getStore: () => MemoryStore | undefined,
): AgentTool<typeof MemorySaveParams> {
  return {
    name: "memory_save",
    label: "Save Memory",
    description:
      "Save a discrete fact to this agent's long-term memory for later keyword recall. Prefer short, self-contained statements; add tags when they aid retrieval. Write sparingly — only durable facts worth remembering across sessions.",
    parameters: MemorySaveParams,
    async execute(_toolCallId, params) {
      const store = getStore();
      if (!store) {
        return { content: [{ type: "text" as const, text: "Error: memory store unavailable." }], details: { error: true } };
      }
      try {
        const entry = store.save(params.content, params.tags);
        return {
          content: [
            { type: "text" as const, text: `Memory saved (${entry.id}). Total entries: ${store.count()}.` },
          ],
          details: { id: entry.id, tags: entry.tags },
        };
      } catch (err) {
        if (err instanceof Error && err.name === "ValidationError") {
          return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], details: { error: true } };
        }
        throw err;
      }
    },
  };
}
