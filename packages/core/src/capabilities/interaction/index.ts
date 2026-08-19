import type { Capability } from "../../kernel/capability.js";
import { createRunCommandTool } from "../../tools/run-command.js";
import { createAskUserTool } from "../../tools/ask-user.js";
import { withApproval } from "../../tools/with-approval.js";

export function interactionCapability(): Capability {
  return {
    id: "interaction",
    tools: (host) => [
      withApproval(createRunCommandTool(host.projectRoot), host.approvalGate),
      createAskUserTool(host.askGate),
    ],
  };
}
