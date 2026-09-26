import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { MAX_CORE_CHARS } from "../store/memory.js";
import type { MemoryStore } from "../store/memory.js";

const MemoryCoreReplaceParams = Type.Object({
  content: Type.String({ description: "The complete new core memory content" }),
});

export function createMemoryCoreReplaceTool(
  getStore: () => MemoryStore | undefined,
): AgentTool<typeof MemoryCoreReplaceParams> {
  return {
    name: "memory_core_replace",
    label: "Replace Core Memory",
    description: `Replace the entire core memory content (the current content is visible in the system prompt). Use to prune outdated or redundant facts. Keep it concise; writes over ${MAX_CORE_CHARS} characters are rejected. Changes take effect in the next session.`,
    parameters: MemoryCoreReplaceParams,
    async execute(_toolCallId, params) {
      const store = getStore();
      if (!store) {
        return { content: [{ type: "text" as const, text: "Error: memory store unavailable." }], details: { error: true } };
      }
      try {
        await store.saveCore(params.content);
        return {
          content: [
            {
              type: "text" as const,
              text: `Core memory replaced (${params.content.length} chars). Takes effect in the next session.`,
            },
          ],
          details: { chars: params.content.length },
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
