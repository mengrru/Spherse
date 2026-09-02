import { create } from "zustand";
import type { ApiClient } from "../../../lib/api";
import { useProjectDataStore } from "../../../stores/project-data-store";
import type { AgentEvent } from "../model/agent-event-parse";
import { ChatRuntimeRegistry } from "./chat-runtime-registry";
import { ChatSessionRuntime } from "./chat-session-runtime";
import {
  loadMoreHistory,
  refreshSessionHistory,
  type HistorySessionPort,
} from "./history-actions";
import {
  applySessionEvents,
  markRetrying,
  type StreamingSessionData,
} from "../model/chat-session-reducer";
import { planRetry } from "../model/retry-plan";
import { lastWithdrawableUserIndex } from "../model/withdrawable";
import type { SendableImage } from "../types";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

interface StreamingSession extends StreamingSessionData {
  attachedCount: number;
  initialMessageSent: boolean;
  projectId: string;
  hasMore: boolean;
  oldestLoadedId: number | null;
  loadingMore: boolean;
  historyStatus: "pending" | "syncing" | "ready";
  connectionStatus: "disconnected" | "connecting" | "open";
  historyError: boolean;
  reconnectFailed: boolean;
  pendingWithdraw: boolean;
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

  function setStreamingAndNotify(sessionId: string, projectId: string, next: boolean) {
    let changed = false;
    updateSession(sessionId, (session) => {
      if (session.streaming === next) return session;
      changed = true;
      return { ...session, streaming: next };
    });
    if (changed) {
      useProjectDataStore.getState().setStreaming(projectId, sessionId, next);
    }
  }

  function executeRetry(sessionId: string): void {
    const session = get().sessions[sessionId];
    const runtime = runtimes.get(sessionId);
    if (!session || session.streaming || !runtime?.isOpen()) return;
    const plan = planRetry(session.messages);
    if (plan.kind === "none") return;

    if (plan.kind === "retry-last") {
      updateSession(sessionId, (current) => ({
        ...current,
        messages: markRetrying(current.messages),
        streaming: true,
        lastActivityAt: Date.now(),
      }));
      useProjectDataStore.getState().setStreaming(session.projectId, sessionId, true);
      runtime.retry();
      return;
    }

    updateSession(sessionId, (current) => ({
      ...current,
      messages: current.messages.slice(0, current.messages.length - plan.dropCount),
    }));
    get().sendMessage(sessionId, plan.content, plan.attachment);
  }

  function applyEventsAndNotify(sessionId: string, events: AgentEvent[]) {
    const before = get().sessions[sessionId]?.streaming;
    updateSession(sessionId, (session) => applySessionEvents(session, events, Date.now()));
    const after = get().sessions[sessionId];
    if (after && after.streaming !== before) {
      useProjectDataStore.getState().setStreaming(after.projectId, sessionId, after.streaming);
    }
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
      const streamingChanges: Array<{ projectId: string; sessionId: string; streaming: boolean }> = [];

      for (const [sessionId, events] of queued) {
        const session = next[sessionId];
        if (!session) continue;
        const settled = applySessionEvents(session, events, now);
        if (settled === session) continue;
        if (settled.streaming !== session.streaming) {
          streamingChanges.push({ projectId: session.projectId, sessionId, streaming: settled.streaming });
        }
        next[sessionId] = settled;
        changed = true;
      }

      if (streamingChanges.length > 0) {
        for (const { projectId, sessionId, streaming } of streamingChanges) {
          useProjectDataStore.getState().setStreaming(projectId, sessionId, streaming);
        }
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
        messages: [],
        streaming: false,
        lastActivityAt: Date.now(),
        scrollPosition: 0,
        attachedCount: Math.max(0, attachedDelta),
        initialMessageSent: false,
        projectId,
        hasMore: false,
        oldestLoadedId: null,
        loadingMore: false,
        historyStatus: "pending",
        connectionStatus: "disconnected",
        historyError: false,
        reconnectFailed: false,
        pendingWithdraw: false,
      };
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: session,
        },
      };
    });
  }

  function sessionPort(sessionId: string): HistorySessionPort<StreamingSession> {
    return {
      getSession: () => get().sessions[sessionId],
      updateSession: (updater) => updateSession(sessionId, updater),
    };
  }

  function connect(client: ApiClient, sessionId: string, baseUrl: string, projectId: string, agentId: string, initialMessage: string | undefined, accessToken: string | null) {
    let runtime = runtimes.get(sessionId);
    if (!runtime) {
      runtime = new ChatSessionRuntime(sessionId, {
        getSession: () => get().sessions[sessionId],
        updateSession: (updater) => updateSession(sessionId, updater),
        enqueueEvent: (event) => enqueueEvent(sessionId, event),
        applyEvents: (events) => applyEventsAndNotify(sessionId, events),
        flushEvents: flushQueuedEvents,
        setStreaming: (streaming) => {
          setStreamingAndNotify(sessionId, projectId, streaming);
        },
        takeInitialMessage: (content) => {
          let shouldSend = false;
          updateSession(sessionId, (session) => {
            if (session.initialMessageSent) return session;
            shouldSend = true;
            return {
              ...session,
              messages: [
                ...session.messages,
                {
                  role: "user",
                  content,
                  timestamp: Date.now(),
                  _optimistic: true,
                },
              ],
              streaming: true,
              lastActivityAt: Date.now(),
              initialMessageSent: true,
            };
          });
          if (shouldSend) {
            useProjectDataStore.getState().setStreaming(
              projectId,
              sessionId,
              true,
            );
          }
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
      if (!content || session.streaming) return false;

      const runtime = runtimes.get(sessionId);
      const attachments = image
        ? [{
            type: "image" as const,
            path: image.path,
            mimeType: image.mimeType,
            width: image.width,
            height: image.height,
          }]
        : undefined;

      const canSend = runtime?.isOpen() ?? false;
      updateSession(sessionId, (current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            role: "user",
            content,
            timestamp: Date.now(),
            _optimistic: true,
            ...(attachments ? { _attachments: attachments } : {}),
            ...(!canSend ? { _sendFailed: true } : {}),
          },
        ],
        ...(canSend
          ? { streaming: true }
          : {}),
        lastActivityAt: Date.now(),
      }));

      if (!canSend) return true;
      useProjectDataStore.getState().setStreaming(session.projectId, sessionId, true);
      runtime!.sendMessage(content, image);
      return true;
    },

    retry(sessionId) {
      executeRetry(sessionId);
    },

    withdrawLastTurn(sessionId) {
      const session = get().sessions[sessionId];
      if (!session || session.streaming) return;
      if (lastWithdrawableUserIndex(session.messages) < 0) return;
      const runtime = runtimes.get(sessionId);
      if (!runtime?.isOpen()) return;
      updateSession(sessionId, (current) => ({ ...current, pendingWithdraw: true }));
      runtime.withdraw();
    },

    abort(sessionId) {
      const session = get().sessions[sessionId];
      if (!session || !runtimes.get(sessionId)?.abort()) {
        if (session) setStreamingAndNotify(sessionId, session.projectId, false);
        return;
      }
      setStreamingAndNotify(sessionId, session.projectId, false);
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
      updateSession(sessionId, (s) => ({ ...s, historyError: false }));
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
        if (!session.streaming && session.attachedCount === 0 && now - session.lastActivityAt > ttlMs) {
          get().disconnect(sessionId);
        }
      }
    },

    loadMore(client, sessionId, agentId) {
      loadMoreHistory(sessionPort(sessionId), client, agentId, sessionId);
    },

    refreshHistory(client, agentId, sessionId) {
      refreshSessionHistory(sessionPort(sessionId), client, agentId, sessionId);
    },
  };
});
