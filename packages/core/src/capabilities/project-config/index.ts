import type { Capability } from "../../kernel/capability.js";
import { createManageProjectConfigTool } from "../../tools/manage-project-config.js";

export function projectConfigCapability(): Capability {
  return {
    id: "project-config",
    tools: (host) => [createManageProjectConfigTool(host.projectStore)],
  };
}
