import type { ApiClient } from "../../../lib/api";
import {
  mergeHistoryMessages,
  parseHistoryMessages,
} from "../model/chat-history";
import type { ChatMessage } from "../types";

export interface HistoryPaginationState {
  messages: ChatMessage[];
  streaming: boolean;
  hasMore: boolean;
  oldestLoadedId: number | null;
  loadingMore: boolean;
  historyStatus: "pending" | "syncing" | "ready";
  historyError: boolean;
}

export interface HistorySessionPort<T extends HistoryPaginationState> {
  getSession(): T | undefined;
  updateSession(updater: (session: T) => T): void;
}

export function loadMoreHistory<T extends HistoryPaginationState>(
  port: HistorySessionPort<T>,
  client: ApiClient,
  agentId: string,
  sessionId: string,
): void {
  const session = port.getSession();
  if (!session || session.loadingMore || !session.hasMore || session.oldestLoadedId === null) return;
  port.updateSession((current) => ({ ...current, loadingMore: true }));
  client.getSessionMessagesPage(agentId, sessionId, { limit: 20, before: session.oldestLoadedId })
    .then((result) => {
      const historyMessages = parseHistoryMessages(result.entries);
      port.updateSession((current) => ({
        ...current,
        messages: mergeHistoryMessages(current.messages, historyMessages),
        hasMore: result.hasMore,
        oldestLoadedId: result.oldestId,
        loadingMore: false,
      }));
    })
    .catch((err: unknown) => {
      console.warn("[history-actions] failed to load more history:", err);
      port.updateSession((current) => ({ ...current, loadingMore: false }));
    });
}

export function refreshSessionHistory<T extends HistoryPaginationState>(
  port: HistorySessionPort<T>,
  client: ApiClient,
  agentId: string,
  sessionId: string,
): void {
  const session = port.getSession();
  if (!session || session.streaming) return;
  client.getSessionMessagesPage(agentId, sessionId, { limit: 20 })
    .then((result) => {
      const historyMessages = parseHistoryMessages(result.entries);
      port.updateSession((current) => {
        if (current.streaming) return current;
        return {
          ...current,
          messages: mergeHistoryMessages(current.messages, historyMessages),
          hasMore: result.hasMore,
          oldestLoadedId: result.oldestId,
          historyStatus: "ready" as const,
          historyError: false,
        };
      });
    })
    .catch((err: unknown) => {
      console.warn("[history-actions] failed to refresh session history:", err);
    });
}
