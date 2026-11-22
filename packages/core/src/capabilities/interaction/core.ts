import type { Capability } from "../../kernel/capability.js";
import { createAskUserTool } from "../../tools/ask-user.js";

export function interactionCoreCapability(): Capability {
  return {
    id: "interaction",
    tools: (host) => [createAskUserTool(host.askGate)],
  };
}
