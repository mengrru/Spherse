import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryStore } from "../store/memory.js";

const MemoryDeleteParams = Type.Object({
  id: Type.String({ description: "The id of the memory entry to delete (shown by memory_recall)" }),
});

export function createMemoryDeleteTool(
  getStore: () => MemoryStore | undefined,
): AgentTool<typeof MemoryDeleteParams> {
  return {
    name: "memory_delete",
    label: "Delete Memory",
    description:
      "Delete a long-term memory entry by id (ids are shown by memory_recall). Use to remove wrong or outdated facts.",
    parameters: MemoryDeleteParams,
    async execute(_toolCallId, params) {
      const store = getStore();
      if (!store) {
        return { content: [{ type: "text" as const, text: "Error: memory store unavailable." }], details: { error: true } };
      }
      try {
        store.deleteEntry(params.id);
        return {
          content: [{ type: "text" as const, text: `Memory entry ${params.id} deleted.` }],
          details: { id: params.id },
        };
      } catch (err) {
        if (err instanceof Error && err.name === "NotFoundError") {
          return {
            content: [{ type: "text" as const, text: `Error: no memory entry with id ${params.id}.` }],
          details: { error: true },
          };
        }
        throw err;
      }
    },
  };
}
