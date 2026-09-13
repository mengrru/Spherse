import { create } from "zustand";
import type { ApiClient } from "../../../lib/api";
import type { SendableImage } from "../types";
import { applyHistoryPage } from "../model/history-entries";
import { reduceLiveEvents } from "../model/entry-reducer";
import { createEventQueue, type EventBatches } from "./event-queue";
import { createHistoryLoader } from "./history-loader";
import { createOutboundActions } from "./outbound-actions";
import { createHttpRecovery, type SessionRecovery } from "./session-recovery";
import {
  createSessionLink,
  type SessionLink,
  type SessionLinkParams,
} from "./session-link";
import { createSessionState, type ChatSessionState } from "./session-state";

interface SessionLinkRecord {
  link: SessionLink;
  params: SessionLinkParams;
}

interface ChatSessionStoreState {
  sessions: Record<string, ChatSessionState>;
}

interface ChatSessionStoreActions {
  attach: (
    client: ApiClient,
    sessionId: string,
    baseUrl: string,
    projectId: string,
    agentId: string,
    initialMessage?: string,
    accessToken?: string | null,
  ) => void;
  detach: (sessionId: string) => void;
  disconnect: (sessionId: string) => void;
  disconnectProject: (projectId: string) => void;
  touch: (sessionId: string) => void;
  sendMessage: (sessionId: string, text: string, image?: SendableImage) => boolean;
  retry: (sessionId: string) => void;
  withdrawLastTurn: (sessionId: string) => void;
  abort: (sessionId: string) => void;
  reconnect: (sessionId: string) => void;
  resumeProbeAll: () => void;
  retryHistory: (client: ApiClient, agentId: string, sessionId: string) => void;
  respondApproval: (sessionId: string, requestId: string, approved: boolean) => boolean;
  respondQuestion: (sessionId: string, requestId: string, answer: string) => boolean;
  setScrollPosition: (sessionId: string, position: number) => void;
  cleanupExpired: (ttlMs: number) => void;
  loadMore: (client: ApiClient, sessionId: string, agentId: string) => void;
  refreshHistory: (client: ApiClient, agentId: string, sessionId: string) => void;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

export const useChatSessionStore = create<ChatSessionStoreState & ChatSessionStoreActions>((set, get) => {
  const links = new Map<string, SessionLinkRecord>();
  const recoveries = new Map<string, SessionRecovery>();
  const queue = createEventQueue(flushBatches);
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;

  function getSession(sessionId: string): ChatSessionState | undefined {
    return get().sessions[sessionId];
  }

  function updateSession(
    sessionId: string,
    updater: (session: ChatSessionState) => ChatSessionState,
  ): void {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      const updated = updater(session);
      if (updated === session) return state;
      return { sessions: { ...state.sessions, [sessionId]: updated } };
    });
  }

  function flushBatches(batches: EventBatches): void {
    const now = Date.now();
    set((state) => {
      let changed = false;
      const sessions = { ...state.sessions };
      for (const [sessionId, events] of batches) {
        const session = sessions[sessionId];
        if (!session) continue;
        const reduced = reduceLiveEvents(session, events, now);
        if (reduced === session) continue;
        sessions[sessionId] = { ...session, ...reduced, lastActivityAt: now };
        changed = true;
      }
      return changed ? { sessions } : state;
    });
  }

  const outbound = createOutboundActions({
    getSession,
    updateSession,
    getLink: (sessionId) => links.get(sessionId)?.link,
    getInitialMessage: (sessionId) => links.get(sessionId)?.params.initialMessage,
  });

  const history = createHistoryLoader({ getSession, updateSession });

  function ensureLink(params: SessionLinkParams): SessionLink {
    const sessionId = params.sessionId;
    const existing = links.get(sessionId);
    if (existing) {
      existing.params = params;
      return existing.link;
    }

    const record: SessionLinkRecord = { link: undefined as unknown as SessionLink, params };
    const link = createSessionLink(() => record.params, {
      onOpen: () => {
        recoveries.get(sessionId)?.onOpen();
        outbound.sendInitialMessage(sessionId);
      },
      onClose: () => {
        recoveries.get(sessionId)?.onClose();
      },
      onStateChange: (change) => {
        updateSession(sessionId, (session) => ({
          ...session,
          connection: {
            state: change.state,
            attempt: change.attempt,
            delayMs: change.delayMs,
            ...(change.closeCode !== undefined ? { closeCode: change.closeCode } : {}),
          },
        }));
      },
      onEvent: (event) => {
        const recovery = recoveries.get(sessionId);
        if (recovery?.onFrame(event)) return;
        queue.push(sessionId, event);
      },
      isAttached: () => (getSession(sessionId)?.attachedCount ?? 0) > 0,
    });
    record.link = link;

    const recovery = createHttpRecovery({
      fetchPage: () => record.params.client.getSessionMessagesPage(
        record.params.agentId,
        sessionId,
        { limit: 20 },
      ),
      applyPage: (page) => {
        updateSession(sessionId, (session) => {
          const merged = applyHistoryPage(session, page, "latest");
          return {
            ...merged,
            history: { ...session.history, hasMore: page.hasMore, oldestSeq: page.oldestId },
          };
        });
      },
      emitEvents: (events) => queue.pushBatch(sessionId, events),
      setHistory: (status, error) => {
        updateSession(sessionId, (session) => ({
          ...session,
          history: { ...session.history, status, error },
        }));
      },
      getHistoryStatus: () => getSession(sessionId)?.history.status ?? "pending",
      isAlive: () => getSession(sessionId) !== undefined && links.get(sessionId) === record,
    });

    links.set(sessionId, record);
    recoveries.set(sessionId, recovery);
    return link;
  }

  function startCleanupTimer(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
      get().cleanupExpired(DEFAULT_TTL_MS);
    }, CLEANUP_INTERVAL_MS);
  }

  function stopCleanupTimerIfEmpty(): void {
    if (Object.keys(get().sessions).length > 0 || !cleanupTimer) return;
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }

  function destroySession(sessionId: string): void {
    recoveries.get(sessionId)?.cancel();
    recoveries.delete(sessionId);
    links.get(sessionId)?.link.dispose();
    links.delete(sessionId);
    queue.cancel(sessionId);
    set((state) => {
      if (!state.sessions[sessionId]) return state;
      const { [sessionId]: _removed, ...rest } = state.sessions;
      return { sessions: rest };
    });
    stopCleanupTimerIfEmpty();
  }

  return {
    sessions: {},

    attach(client, sessionId, baseUrl, projectId, agentId, initialMessage, accessToken) {
      set((state) => {
        const existing = state.sessions[sessionId];
        if (existing) {
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                attachedCount: existing.attachedCount + 1,
                lastActivityAt: Date.now(),
              },
            },
          };
        }
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: createSessionState(sessionId, projectId, agentId, 1),
          },
        };
      });
      const link = ensureLink({
        client,
        baseUrl,
        projectId,
        agentId,
        sessionId,
        accessToken: accessToken ?? null,
        ...(initialMessage !== undefined ? { initialMessage } : {}),
      });
      link.connect();
      startCleanupTimer();
    },

    detach(sessionId) {
      updateSession(sessionId, (session) => ({
        ...session,
        attachedCount: Math.max(0, session.attachedCount - 1),
        lastActivityAt: Date.now(),
      }));
    },

    disconnect(sessionId) {
      destroySession(sessionId);
    },

    disconnectProject(projectId) {
      const sessionIds = Object.values(get().sessions)
        .filter((session) => session.projectId === projectId)
        .map((session) => session.sessionId);
      for (const sessionId of sessionIds) {
        destroySession(sessionId);
      }
    },

    touch(sessionId) {
      updateSession(sessionId, (session) => ({ ...session, lastActivityAt: Date.now() }));
    },

    sendMessage(sessionId, text, image) {
      return outbound.sendMessage(sessionId, text, image);
    },

    retry(sessionId) {
      outbound.retry(sessionId);
    },

    withdrawLastTurn(sessionId) {
      outbound.withdrawLastTurn(sessionId);
    },

    abort(sessionId) {
      outbound.abort(sessionId);
    },

    reconnect(sessionId) {
      links.get(sessionId)?.link.reconnect();
    },

    resumeProbeAll() {
      for (const session of Object.values(get().sessions)) {
        if (session.attachedCount <= 0) continue;
        links.get(session.sessionId)?.link.probe();
      }
    },

    retryHistory(client, agentId, sessionId) {
      history.retryHistory(client, sessionId, agentId);
    },

    respondApproval(sessionId, requestId, approved) {
      return outbound.respondApproval(sessionId, requestId, approved);
    },

    respondQuestion(sessionId, requestId, answer) {
      return outbound.respondQuestion(sessionId, requestId, answer);
    },

    setScrollPosition(sessionId, position) {
      updateSession(sessionId, (session) => (
        session.scrollPosition === position ? session : { ...session, scrollPosition: position }
      ));
    },

    cleanupExpired(ttlMs) {
      const now = Date.now();
      for (const session of Object.values(get().sessions)) {
        if (!session.streaming && session.attachedCount === 0 && now - session.lastActivityAt > ttlMs) {
          destroySession(session.sessionId);
        }
      }
    },

    loadMore(client, sessionId, agentId) {
      history.loadMore(client, sessionId, agentId);
    },

    refreshHistory(client, agentId, sessionId) {
      history.refreshHistory(client, sessionId, agentId);
    },
  };
});

export type { ChatSessionState };
