import type { Capability } from "../../kernel/capability.js";
import { createRunCommandTool } from "../../tools/run-command.js";
import { withApproval } from "../../tools/with-approval.js";

export function runCommandCapability(): Capability {
  return {
    id: "interaction",
    tools: (host) => [withApproval(createRunCommandTool(host.projectRoot), host.approvalGate)],
  };
}
