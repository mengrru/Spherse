import type { Capability } from "../../kernel/capability.js";
import { interactionCoreCapability } from "./core.js";
import { runCommandCapability } from "./run-command.js";

export function interactionCapability(): Capability {
  const runCommand = runCommandCapability();
  const core = interactionCoreCapability();
  return {
    id: "interaction",
    tools: (host) => [
      ...(runCommand.tools?.(host) ?? []),
      ...(core.tools?.(host) ?? []),
    ],
  };
}
