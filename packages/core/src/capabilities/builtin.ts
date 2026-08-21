import type { Capability } from "../kernel/capability.js";
import type { DataStore } from "./data/index.js";
import { fsCapability } from "./fs/index.js";
import { skillCapability } from "./skill/index.js";
import { changelogCapability } from "./changelog/index.js";
import { renderCapability } from "./render/index.js";
import { agentMgmtCapability } from "./agent-mgmt/index.js";
import { interactionCapability } from "./interaction/index.js";
import { dataCapability } from "./data/index.js";

export function builtinToolCapabilities(sharedDataStore?: DataStore): Capability[] {
  return [
    fsCapability(),
    skillCapability(),
    changelogCapability(),
    renderCapability(),
    agentMgmtCapability(),
    interactionCapability(),
    dataCapability(sharedDataStore),
  ];
}
