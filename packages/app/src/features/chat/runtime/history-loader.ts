import type { ApiClient } from "../../../lib/api";
import { applyHistoryPage } from "../model/history-entries";
import type { ChatSessionState } from "./session-state";

export interface HistoryLoaderHost {
  getSession(sessionId: string): ChatSessionState | undefined;
  updateSession(sessionId: string, updater: (session: ChatSessionState) => ChatSessionState): void;
}

export interface HistoryLoader {
  loadMore(client: ApiClient, sessionId: string, agentId: string): void;
  refreshHistory(client: ApiClient, sessionId: string, agentId: string): void;
  retryHistory(client: ApiClient, sessionId: string, agentId: string): void;
}

const PAGE_LIMIT = 20;

export function createHistoryLoader(host: HistoryLoaderHost): HistoryLoader {
  function refreshHistory(client: ApiClient, sessionId: string, agentId: string): void {
    const session = host.getSession(sessionId);
    if (!session || session.streaming) return;
    const generation = session.generation;
    client.getSessionMessagesPage(agentId, sessionId, { limit: PAGE_LIMIT })
      .then((result) => {
        host.updateSession(sessionId, (current) => {
          if (current.generation !== generation || current.streaming) return current;
          const merged = applyHistoryPage(current, result, "latest");
          return {
            ...merged,
            history: {
              ...current.history,
              status: "ready",
              hasMore: result.hasMore,
              oldestSeq: result.oldestId,
              error: false,
            },
          };
        });
      })
      .catch((err: unknown) => {
        console.warn("[chat-session-store] failed to refresh session history:", err);
      });
  }

  return {
    loadMore(client, sessionId, agentId) {
      const session = host.getSession(sessionId);
      if (
        !session ||
        session.history.loadingMore ||
        !session.history.hasMore ||
        session.history.oldestSeq === null
      ) {
        return;
      }
      const generation = session.generation;
      const before = session.history.oldestSeq;
      host.updateSession(sessionId, (current) => (
        current.generation === generation
          ? { ...current, history: { ...current.history, loadingMore: true } }
          : current
      ));
      client.getSessionMessagesPage(agentId, sessionId, { limit: PAGE_LIMIT, before })
        .then((result) => {
          host.updateSession(sessionId, (current) => {
            if (current.generation !== generation) return current;
            const merged = applyHistoryPage(current, result, "loadMore");
            return {
              ...merged,
              history: {
                ...current.history,
                hasMore: result.hasMore,
                oldestSeq: result.oldestId,
                loadingMore: false,
              },
            };
          });
        })
        .catch((err: unknown) => {
          console.warn("[chat-session-store] failed to load more history:", err);
          host.updateSession(sessionId, (current) => (
            current.generation === generation
              ? { ...current, history: { ...current.history, loadingMore: false } }
              : current
          ));
        });
    },

    refreshHistory,

    retryHistory(client, sessionId, agentId) {
      host.updateSession(sessionId, (current) => (
        current.history.error
          ? { ...current, history: { ...current.history, error: false } }
          : current
      ));
      refreshHistory(client, sessionId, agentId);
    },
  };
}
