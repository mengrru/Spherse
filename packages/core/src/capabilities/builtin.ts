import type { Capability } from "../kernel/capability.js";
import { fsCapability } from "./fs/index.js";
import { skillCapability } from "./skill/index.js";
import { changelogCapability } from "./changelog/index.js";
import { renderCapability } from "./render/index.js";
import { agentMgmtCapability } from "./agent-mgmt/index.js";
import { interactionCapability } from "./interaction/index.js";

export function builtinToolCapabilities(): Capability[] {
  return [
    fsCapability(),
    skillCapability(),
    changelogCapability(),
    renderCapability(),
    agentMgmtCapability(),
    interactionCapability(),
  ];
}
