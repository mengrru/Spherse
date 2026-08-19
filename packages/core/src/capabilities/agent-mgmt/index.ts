import type { Capability } from "../../kernel/capability.js";
import { createManageAgentTool, isManageAgentWriteAction } from "../../tools/manage-agent.js";
import { withApproval } from "../../tools/with-approval.js";

export function agentMgmtCapability(): Capability {
  return {
    id: "agent-mgmt",
    tools: (host) => [
      withApproval(
        createManageAgentTool(host.projectStore, host.toolCatalog, host.agentId),
        host.approvalGate,
        isManageAgentWriteAction,
      ),
    ],
  };
}
