import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryStore } from "../store/memory.js";

const MemoryCoreAppendParams = Type.Object({
  content: Type.String({ description: "The fact or note to append to core memory" }),
});

export function createMemoryCoreAppendTool(
  getStore: () => MemoryStore | undefined,
): AgentTool<typeof MemoryCoreAppendParams> {
  return {
    name: "memory_core_append",
    label: "Append Core Memory",
    description:
      "Append a durable fact to core memory — the concise, always-visible profile of the user and ongoing work. Use for stable facts only (identity, preferences, long-term commitments); granular facts belong in memory_save. Write sparingly; changes take effect in the next session.",
    parameters: MemoryCoreAppendParams,
    async execute(_toolCallId, params) {
      const store = getStore();
      if (!store) {
        return { content: [{ type: "text" as const, text: "Error: memory store unavailable." }], details: { error: true } };
      }
      try {
        const core = await store.appendCore(params.content);
        return {
          content: [
            {
              type: "text" as const,
              text: `Appended to core memory (${core.length} chars total). Takes effect in the next session.`,
            },
          ],
          details: { chars: core.length },
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
