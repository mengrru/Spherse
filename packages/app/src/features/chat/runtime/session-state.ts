import type { WsConnectionState } from "../../../lib/ws/ws-connection";
import type { ChatEntry, EntryId } from "../model/entry";

export interface ChatHistoryState {
  status: "pending" | "syncing" | "ready";
  hasMore: boolean;
  oldestSeq: number | null;
  loadingMore: boolean;
  error: boolean;
}

export interface ChatConnectionState {
  state: WsConnectionState;
  attempt: number;
  delayMs: number;
  closeCode?: number;
}

export interface ChatSessionState {
  sessionId: string;
  generation: number;
  projectId: string;
  agentId: string;
  entries: ChatEntry[];
  openStreamId: EntryId | null;
  ownerAssistantId: EntryId | null;
  streaming: boolean;
  pendingWithdraw: boolean;
  cursor: number;
  initialMessageSent: boolean;
  connection: ChatConnectionState;
  history: ChatHistoryState;
  scrollPosition: number;
  attachedCount: number;
  lastActivityAt: number;
}

let generationCounter = 0;

export function createSessionState(
  sessionId: string,
  projectId: string,
  agentId: string,
  attachedCount: number,
): ChatSessionState {
  generationCounter += 1;
  return {
    sessionId,
    generation: generationCounter,
    projectId,
    agentId,
    entries: [],
    openStreamId: null,
    ownerAssistantId: null,
    streaming: false,
    pendingWithdraw: false,
    cursor: -1,
    initialMessageSent: false,
    connection: { state: "idle", attempt: 0, delayMs: 0 },
    history: { status: "pending", hasMore: false, oldestSeq: null, loadingMore: false, error: false },
    scrollPosition: 0,
    attachedCount: Math.max(0, attachedCount),
    lastActivityAt: Date.now(),
  };
}
