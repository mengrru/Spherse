export interface TurnContextSnapshot {
  sessionId: string;
  capturedAt: string;
  systemPrompt: string;
  messages: unknown[];
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
}

export type ControlRequestKind = "approval" | "question";

export type SessionControlEvent =
  | {
      type: "control_request";
      requestId: string;
      kind: "approval";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "control_resolved";
      requestId: string;
      kind: "approval";
      approved: boolean;
      reason?: string;
    }
  | {
      type: "control_request";
      requestId: string;
      kind: "question";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "control_resolved";
      requestId: string;
      kind: "question";
      answer?: string;
      timedOut: boolean;
    };
