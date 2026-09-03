import { create } from "zustand";
import type { ApiClient } from "../../../lib/api";
import { useProjectDataStore } from "../../../stores/project-data-store";
import type { AgentEvent } from "../model/agent-event-parse";
import { ChatRuntimeRegistry } from "./chat-runtime-registry";
import { ChatSessionRuntime } from "./chat-session-runtime";
import {
  applyAbort,
  applyHistoryResult,
  applyRetryLast,
  createInitialSessionData,
  createOutboxEntry,
  reduceSessionEvents,
  truncateForResend,
} from "../model/session-events";
import { buildRenderList } from "../model/render-list";
import { planRetry } from "../model/retry-plan";
import { lastWithdrawableUserIndex } from "../model/withdrawable";
import { isSessionStreaming, type ChatSessionData, type SendableImage } from "../types";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

interface StreamingSession extends ChatSessionData {
  attachedCount: number;
  initialMessageSent: boolean;
  projectId: string;
  loadingMore: boolean;
  connectionStatus: "disconnected" | "connecting" | "open";
  reconnectFailed: boolean;
}

interface StreamingStoreState {
  sessions: Record<string, StreamingSession>;
}

interface StreamingStoreActions {
  attach: (client: ApiClient, sessionId: string, baseUrl: string, projectId: string, agentId: string, initialMessage?: string, accessToken?: string | null) => void;
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

export const useStreamingStore = create<StreamingStoreState & StreamingStoreActions>((set, get) => {
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;
  const runtimes = new ChatRuntimeRegistry<StreamingSession>();
  const eventQueue = new Map<string, AgentEvent[]>();
  let flushRaf: number | undefined;

  function updateSession(
    sessionId: string,
    updater: (session: StreamingSession) => StreamingSession,
  ) {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      const updated = updater(session);
      if (updated === session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: updated,
        },
      };
    });
  }

  function executeRetry(sessionId: string): void {
    const session = get().sessions[sessionId];
    const runtime = runtimes.get(sessionId);
    if (!session || isSessionStreaming(session) || !runtime?.isOpen()) return;
    const plan = planRetry(buildRenderList(session), session);
    if (plan.kind === "none") return;

    if (plan.kind === "retry-last") {
      updateSession(sessionId, (current) => applyRetryLast(current));
      runtime.retry();
      return;
    }

    updateSession(sessionId, (current) => truncateForResend(current));
    get().sendMessage(sessionId, plan.content, plan.attachment);
  }

  function flushQueuedEvents() {
    flushRaf = undefined;
    if (eventQueue.size === 0) return;
    const queued = new Map(eventQueue);
    eventQueue.clear();

    set((state) => {
      const now = Date.now();
      const next = { ...state.sessions };
      let changed = false;

      for (const [sessionId, events] of queued) {
        const session = next[sessionId];
        if (!session) continue;
        const reduced = reduceSessionEvents(session, events, now);
        if (reduced === session) continue;
        next[sessionId] = reduced;
        changed = true;
      }

      return changed ? { sessions: next } : state;
    });
  }

  function enqueueEvent(sessionId: string, event: AgentEvent) {
    let queue = eventQueue.get(sessionId);
    if (!queue) {
      queue = [];
      eventQueue.set(sessionId, queue);
    }
    queue.push(event);
    if (flushRaf === undefined) {
      flushRaf = requestAnimationFrame(flushQueuedEvents);
    }
  }

  function startCleanupTimer() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
      get().cleanupExpired(DEFAULT_TTL_MS);
    }, CLEANUP_INTERVAL_MS);
  }

  function ensureSession(sessionId: string, attachedDelta: number, projectId: string) {
    set((state) => {
      const existing = state.sessions[sessionId];
      if (existing) {
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...existing,
              attachedCount: Math.max(0, existing.attachedCount + attachedDelta),
              lastActivityAt: Date.now(),
            },
          },
        };
      }

      const session: StreamingSession = {
        ...createInitialSessionData(),
        lastActivityAt: Date.now(),
        attachedCount: Math.max(0, attachedDelta),
        initialMessageSent: false,
        projectId,
        loadingMore: false,
        connectionStatus: "disconnected",
        reconnectFailed: false,
      };
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: session,
        },
      };
    });
  }

  function connect(client: ApiClient, sessionId: string, baseUrl: string, projectId: string, agentId: string, initialMessage: string | undefined, accessToken: string | null) {
    let runtime = runtimes.get(sessionId);
    if (!runtime) {
      runtime = new ChatSessionRuntime(sessionId, {
        getSession: () => get().sessions[sessionId],
        updateSession: (updater) => updateSession(sessionId, updater),
        enqueueEvent: (event) => enqueueEvent(sessionId, event),
        applyEvents: (events) => {
          updateSession(sessionId, (session) => reduceSessionEvents(session, events, Date.now()));
        },
        applyHistoryResult: (result, mode) => {
          updateSession(sessionId, (session) => applyHistoryResult(session, result, mode));
        },
        flushEvents: flushQueuedEvents,
        takeInitialMessage: (content) => {
          let shouldSend = false;
          updateSession(sessionId, (session) => {
            if (session.initialMessageSent) return session;
            shouldSend = true;
            const { session: next } = createOutboxEntry(
              session,
              content,
              undefined,
              false,
              `init-${sessionId}-${Date.now()}`,
            );
            return { ...next, initialMessageSent: true };
          });
          return shouldSend;
        },
        shouldReconnect: () => (
          (get().sessions[sessionId]?.attachedCount ?? 0) > 0
        ),
      });
      runtimes.set(sessionId, runtime);
    }
    runtime.connect({
      client,
      baseUrl,
      projectId,
      agentId,
      initialMessage,
      accessToken,
    });
    startCleanupTimer();
  }

  return {
    sessions: {},

    attach(client, sessionId, baseUrl, projectId, agentId, initialMessage, accessToken) {
      ensureSession(sessionId, 1, projectId);
      connect(client, sessionId, baseUrl, projectId, agentId, initialMessage, accessToken ?? null);
    },

    detach(sessionId) {
      updateSession(sessionId, (session) => ({
        ...session,
        attachedCount: Math.max(0, session.attachedCount - 1),
        lastActivityAt: Date.now(),
      }));
    },

    disconnect(sessionId) {
      runtimes.delete(sessionId);
      eventQueue.delete(sessionId);
      set((state) => {
        if (!state.sessions[sessionId]) return state;
        const { [sessionId]: _removed, ...rest } = state.sessions;
        return { sessions: rest };
      });
      if (Object.keys(get().sessions).length === 0 && cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = undefined;
      }
    },

    disconnectProject(projectId) {
      const sessionIds = Object.entries(get().sessions)
        .filter(([, session]) => session.projectId === projectId)
        .map(([sessionId]) => sessionId);
      for (const sessionId of sessionIds) {
        get().disconnect(sessionId);
      }
    },

    touch(sessionId) {
      updateSession(sessionId, (session) => ({ ...session, lastActivityAt: Date.now() }));
    },

    sendMessage(sessionId, text, image) {
      const session = get().sessions[sessionId];
      if (!session) return false;
      const content = text.trim();
      if (!content || isSessionStreaming(session)) return false;

      const runtime = runtimes.get(sessionId);
      const canSend = runtime?.isOpen() ?? false;
      const attachments = image
        ? [{
            type: "image" as const,
            path: image.path,
            mimeType: image.mimeType,
            width: image.width,
            height: image.height,
          }]
        : undefined;

      updateSession(sessionId, (current) =>
        createOutboxEntry(
          current,
          content,
          attachments,
          !canSend,
          `msg-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ).session,
      );

      if (!canSend) return true;
      runtime!.sendMessage(content, image);
      return true;
    },

    retry(sessionId) {
      executeRetry(sessionId);
    },

    withdrawLastTurn(sessionId) {
      const session = get().sessions[sessionId];
      if (!session || isSessionStreaming(session)) return;
      if (lastWithdrawableUserIndex(buildRenderList(session)) < 0) return;
      const runtime = runtimes.get(sessionId);
      if (!runtime?.isOpen()) return;
      updateSession(sessionId, (current) =>
        current.pendingWithdraw ? current : { ...current, pendingWithdraw: true },
      );
      runtime.withdraw();
    },

    abort(sessionId) {
      const session = get().sessions[sessionId];
      if (!session) return;
      runtimes.get(sessionId)?.abort();
      updateSession(sessionId, (current) => applyAbort(current));
    },

    reconnect(sessionId) {
      runtimes.get(sessionId)?.reconnect();
    },

    /**
     * Probe every attached session's socket for liveness after a host resume.
     * Detached (cached) sessions are skipped: nothing observes them until the
     * next attach, and their stale sockets are handled by the heartbeat
     * watchdog / attach-time reconnect.
     */
    resumeProbeAll() {
      for (const [sessionId, session] of Object.entries(get().sessions)) {
        if (session.attachedCount <= 0) continue;
        runtimes.get(sessionId)?.probe();
      }
    },

    retryHistory(client, agentId, sessionId) {
      updateSession(sessionId, (s) => ({
        ...s,
        history: { ...s.history, historyError: false },
      }));
      get().refreshHistory(client, agentId, sessionId);
    },

    respondApproval(sessionId, requestId, approved) {
      return runtimes.get(sessionId)?.respondApproval(requestId, approved) ?? false;
    },

    respondQuestion(sessionId, requestId, answer) {
      return runtimes.get(sessionId)?.respondQuestion(requestId, answer) ?? false;
    },

    setScrollPosition(sessionId, position) {
      updateSession(sessionId, (session) => (
        session.scrollPosition === position ? session : { ...session, scrollPosition: position }
      ));
    },

    cleanupExpired(ttlMs) {
      const now = Date.now();
      const sessions = get().sessions;
      for (const [sessionId, session] of Object.entries(sessions)) {
        if (!isSessionStreaming(session) && session.attachedCount === 0 && now - session.lastActivityAt > ttlMs) {
          get().disconnect(sessionId);
        }
      }
    },

    loadMore(client, sessionId, agentId) {
      const session = get().sessions[sessionId];
      if (!session || session.loadingMore || !session.history.hasMore || session.history.oldestLoadedId === null) return;
      updateSession(sessionId, (s) => ({ ...s, loadingMore: true }));
      client.getSessionMessagesPage(agentId, sessionId, { limit: 20, before: session.history.oldestLoadedId })
        .then((result) => {
          updateSession(sessionId, (s) => ({
            ...applyHistoryResult(s, result, "loadMore"),
            loadingMore: false,
          }));
        })
        .catch((err: unknown) => {
          console.warn("[streaming-store] failed to load more history:", err);
          updateSession(sessionId, (s) => ({ ...s, loadingMore: false }));
        });
    },

    refreshHistory(client, agentId, sessionId) {
      const session = get().sessions[sessionId];
      if (!session || isSessionStreaming(session)) return;
      client.getSessionMessagesPage(agentId, sessionId, { limit: 20 })
        .then((result) => {
          const current = get().sessions[sessionId];
          if (!current || isSessionStreaming(current)) return;
          updateSession(sessionId, (s) => applyHistoryResult(s, result, "refresh"));
        })
        .catch((err: unknown) => {
          console.warn("[streaming-store] failed to refresh session history:", err);
        });
    },
  };
});

const lastStreamingSync = new Map<string, boolean>();

useStreamingStore.subscribe((state) => {
  for (const [sessionId, session] of Object.entries(state.sessions)) {
    const streaming = isSessionStreaming(session);
    const prev = lastStreamingSync.get(sessionId) ?? false;
    if (prev !== streaming) {
      useProjectDataStore.getState().setStreaming(session.projectId, sessionId, streaming);
      lastStreamingSync.set(sessionId, streaming);
    }
  }
  for (const sessionId of [...lastStreamingSync.keys()]) {
    if (!(sessionId in state.sessions)) lastStreamingSync.delete(sessionId);
  }
});
