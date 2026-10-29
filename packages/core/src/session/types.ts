export interface CompactionSnapshotMeta {
  seq: number;
  anchorSeq: number;
  digestSource: "llm" | "mechanical" | null;
  excludedCount: number;
  digestLength: number;
  appliedAtMs: number;
}

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
  compaction: CompactionSnapshotMeta | null;
  compactionCount: number;
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
      seq?: number;
    }
  | {
      type: "control_resolved";
      requestId: string;
      kind: "approval";
      approved: boolean;
      reason?: string;
      aborted?: boolean;
      seq?: number;
    }
  | {
      type: "control_request";
      requestId: string;
      kind: "question";
      toolCallId: string;
      toolName: string;
      args: unknown;
      seq?: number;
    }
  | {
      type: "control_resolved";
      requestId: string;
      kind: "question";
      answer?: string;
      timedOut: boolean;
      aborted?: boolean;
      seq?: number;
    };
