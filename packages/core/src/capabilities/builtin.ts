import type { Capability } from "../kernel/capability.js";
import type { DataStore } from "./data/index.js";
import { fsCapability } from "./fs/index.js";
import { skillCapability } from "./skill/index.js";
import { changelogCapability } from "./changelog/index.js";
import { renderCapability } from "./render/index.js";
import { agentMgmtCapability } from "./agent-mgmt/index.js";
import { interactionCoreCapability } from "./interaction/core.js";
import { projectConfigCapability } from "./project-config/index.js";
import { dataCapability } from "./data/index.js";
import { webSearchCapability } from "./web-search/index.js";

export interface BuiltinToolCapabilitiesOptions {
  interaction?: Capability;
}

export function builtinToolCapabilities(
  sharedDataStore?: DataStore,
  options?: BuiltinToolCapabilitiesOptions,
): Capability[] {
  return [
    fsCapability(),
    skillCapability(),
    changelogCapability(),
    renderCapability(),
    agentMgmtCapability(),
    options?.interaction ?? interactionCoreCapability(),
    projectConfigCapability(),
    dataCapability(sharedDataStore),
    webSearchCapability(),
  ];
}
