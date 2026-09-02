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

export const COVERAGE_MAX_PAGES = 50;

export function resolveHistoryLowWater(session: {
  oldestLoadedId: number | null;
  messages: ChatMessage[];
}): number | null {
  if (session.oldestLoadedId !== null) return session.oldestLoadedId;
  return session.messages.some((message) => message._messageId === undefined) ? 0 : null;
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
  const lowWater = resolveHistoryLowWater(session);
  void refreshWithCoverage(port, client, agentId, sessionId, lowWater);
}

async function refreshWithCoverage<T extends HistoryPaginationState>(
  port: HistorySessionPort<T>,
  client: ApiClient,
  agentId: string,
  sessionId: string,
  lowWater: number | null,
): Promise<void> {
  try {
    const result = await client.getSessionMessagesPage(agentId, sessionId, { limit: 20 });
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
    if (lowWater === null) return;
    for (let page = 0; page < COVERAGE_MAX_PAGES; page++) {
      const current = port.getSession();
      if (!current || current.streaming) return;
      if (!current.hasMore || current.oldestLoadedId === null) return;
      if (current.oldestLoadedId <= lowWater) return;
      const olderResult = await client.getSessionMessagesPage(agentId, sessionId, {
        limit: 20,
        before: current.oldestLoadedId,
      });
      if (olderResult.entries.length === 0) return;
      const olderMessages = parseHistoryMessages(olderResult.entries);
      port.updateSession((session) => {
        if (session.streaming) return session;
        return {
          ...session,
          messages: mergeHistoryMessages(session.messages, olderMessages),
          hasMore: olderResult.hasMore,
          oldestLoadedId: olderResult.oldestId,
        };
      });
    }
  } catch (err) {
    console.warn("[history-actions] failed to refresh session history:", err);
  }
}
