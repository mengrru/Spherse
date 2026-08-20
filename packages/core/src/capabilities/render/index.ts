import type { Capability } from "../../kernel/capability.js";
import { createRenderCardTool } from "../../tools/render-card.js";
import { llmPolicyOf } from "../shared/llm-policy.js";

export function renderCapability(): Capability {
  return {
    id: "render",
    tools: (host) => [
      createRenderCardTool(host.projectRoot, llmPolicyOf(host)),
    ],
  };
}
