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

export interface AskOutcome {
  answer?: string;
  timedOut: boolean;
}

export interface AskGate {
  ask(
    req: { requestId: string; toolCallId: string; toolName: string; args: unknown },
    timeoutMs: number,
  ): Promise<AskOutcome>;
}
