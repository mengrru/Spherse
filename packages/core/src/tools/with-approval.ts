import crypto from "node:crypto";
import type { TSchema } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface ApprovalRequest {
  requestId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

export interface ApprovalGate {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

export function withApproval<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
  gate: ApprovalGate | undefined,
): AgentTool<TParams, TDetails> {
  if (!gate) return tool;
  const original = tool.execute;
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate) {
      const decision = await gate.request({
        requestId: crypto.randomUUID(),
        toolCallId,
        toolName: tool.name,
        args: params,
      });
      if (!decision.approved) {
        const note = decision.reason ? `: ${decision.reason}` : "";
        return {
          content: [{ type: "text" as const, text: `Execution rejected by user${note}.` }],
          details: { rejected: true, reason: decision.reason } as unknown as TDetails,
        };
      }
      return original(toolCallId, params, signal, onUpdate);
    },
  };
}
