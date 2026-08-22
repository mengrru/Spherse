import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";

export type TurnEndReason = "completed" | "aborted" | "error";

export interface SessionEventMap {
  "turn/start": Record<string, never>;
  "turn/end": { reason: TurnEndReason };
  "user/message": { message: AgentMessage };
  "assistant/message": { message: AssistantMessage };
  "tool/result": { message: ToolResultMessage };
  "compaction/applied": {
    anchorSeq: number;
    digestContent: string;
    excludedSeqs: number[];
    digestSource?: "llm" | "mechanical";
  };
  "turn/retried": { abandonedSeqs: number[] };
}

export type SessionEventType = keyof SessionEventMap;

export type SessionEventOf<T extends SessionEventType> = {
  [K in SessionEventType]: {
    type: K;
    seq: number;
    time: number;
    data: SessionEventMap[K];
  };
}[T];

export type SessionEvent = SessionEventOf<SessionEventType>;

export const MESSAGE_EVENT_TYPES: ReadonlySet<SessionEventType> = new Set([
  "user/message",
  "assistant/message",
  "tool/result",
]);

export const EVENT_SCHEMA_VERSION = 1;
