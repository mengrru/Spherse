import { create } from "zustand";
import type { ApiClient } from "../../../lib/api";
import type { SendableImage } from "../types";
import { reduceLiveEvents } from "../model/entry-reducer";
import { createEventQueue, type EventBatches } from "./event-queue";
import { createHistoryLoader } from "./history-loader";
import { createOutboundActions } from "./outbound-actions";
import { createSessionLifecycle } from "./session-lifecycle";
import { createSessionState, type ChatSessionState } from "./session-state";

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

export const useChatSessionStore = create<ChatSessionStoreState & ChatSessionStoreActions>((set, get) => {
  const queue = createEventQueue(flushBatches);

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

  function removeSession(sessionId: string): void {
    set((state) => {
      if (!state.sessions[sessionId]) return state;
      const { [sessionId]: _removed, ...rest } = state.sessions;
      return { sessions: rest };
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

  let sendInitialMessage: (sessionId: string) => void = () => {};

  const lifecycle = createSessionLifecycle(
    { getSession, getSessions: () => get().sessions, updateSession, removeSession },
    {
      onLinkOpen: (sessionId) => sendInitialMessage(sessionId),
      deliverEvents: (sessionId, events) => queue.pushBatch(sessionId, events),
      cancelQueued: (sessionId) => queue.cancel(sessionId),
      flushPending: () => queue.flushNow(),
    },
  );

  const outbound = createOutboundActions({
    getSession,
    updateSession,
    getLink: (sessionId) => lifecycle.getLink(sessionId),
    getInitialMessage: (sessionId) => lifecycle.getInitialMessage(sessionId),
  });

  sendInitialMessage = (sessionId) => outbound.sendInitialMessage(sessionId);

  const history = createHistoryLoader({ getSession, updateSession });

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
      lifecycle.attach({
        client,
        baseUrl,
        projectId,
        agentId,
        sessionId,
        accessToken: accessToken ?? null,
        ...(initialMessage !== undefined ? { initialMessage } : {}),
      });
    },

    detach(sessionId) {
      lifecycle.detach(sessionId);
    },

    disconnect(sessionId) {
      lifecycle.disconnect(sessionId);
    },

    disconnectProject(projectId) {
      lifecycle.disconnectProject(projectId);
    },

    touch(sessionId) {
      lifecycle.touch(sessionId);
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
      lifecycle.reconnect(sessionId);
    },

    resumeProbeAll() {
      lifecycle.resumeProbeAll();
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
      lifecycle.cleanupExpired(ttlMs);
    },

    loadMore(client, sessionId, agentId) {
      history.loadMore(client, sessionId, agentId);
    },

    refreshHistory(client, agentId, sessionId) {
      history.refreshHistory(client, agentId, sessionId);
    },
  };
});

export type { ChatSessionState };
