import type { ApprovalDecision, ApprovalGate, ApprovalRequest } from "../tools/with-approval.js";
import type { SessionControlBus } from "./control-bus.js";

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export function createApprovalGate(bus: SessionControlBus): ApprovalGate {
  return {
    request(req: ApprovalRequest): Promise<ApprovalDecision> {
      return bus.request<ApprovalDecision>(
        {
          requestId: req.requestId,
          kind: "approval",
          toolCallId: req.toolCallId,
          toolName: req.toolName,
          args: req.args,
        },
        APPROVAL_TIMEOUT_MS,
        { approved: false, reason: "approval timeout" },
      );
    },
  };
}
