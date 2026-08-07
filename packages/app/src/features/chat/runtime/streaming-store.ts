import { create } from "zustand";
import type { ApiClient } from "../../../lib/api";
import { useProjectDataStore } from "../../../stores/project-data-store";
import type { AgentEvent } from "../model/agent-event-parse";
import {
  mergeHistoryMessages,
  parseHistoryMessages,
} from "../model/chat-history";
import { ChatRuntimeRegistry } from "./chat-runtime-registry";
import { ChatSessionRuntime } from "./chat-session-runtime";
import {
  reduceSessionEvents,
  type StreamingSessionData,
} from "../model/chat-session-reducer";
import type { AttachedImage } from "../types";

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
}

interface StreamingStoreState {
  sessions: Record<string, StreamingSession>;
}

interface StreamingStoreActions {
  attach: (client: ApiClient, sessionId: string, baseUrl: string, projectId: string, agentId: string, initialMessage?: string, accessToken?: string | null) => void;
  detach: (sessionId: string) => void;
  disconnect: (sessionId: string) => void;
  touch: (sessionId: string) => void;
  sendMessage: (sessionId: string, text: string, image?: AttachedImage) => boolean;
  abort: (sessionId: string) => void;
  respondApproval: (sessionId: string, requestId: string, approved: boolean) => void;
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
        const reduced = reduceSessionEvents(session, events, now);
        if (reduced === session) continue;
        if (reduced.streaming !== session.streaming) {
          streamingChanges.push({ projectId: session.projectId, sessionId, streaming: reduced.streaming });
        }
        next[sessionId] = { ...session, ...reduced };
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
          updateSession(sessionId, (session) => ({
            ...session,
            ...reduceSessionEvents(session, events, Date.now()),
          }));
          const session = get().sessions[sessionId];
          if (session) {
            useProjectDataStore.getState().setStreaming(
              session.projectId,
              sessionId,
              session.streaming,
            );
          }
        },
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

    touch(sessionId) {
      updateSession(sessionId, (session) => ({ ...session, lastActivityAt: Date.now() }));
    },

    sendMessage(sessionId, text, image) {
      const session = get().sessions[sessionId];
      const runtime = runtimes.get(sessionId);
      if (!session || !runtime?.isOpen()) return false;
      const content = text.trim();
      if (!content || session.streaming) return false;
      updateSession(sessionId, (current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            role: "user",
            content,
            timestamp: Date.now(),
            _optimistic: true,
            ...(image
              ? {
                  _attachments: [
                    {
                      type: "image" as const,
                      path: image.path,
                      mimeType: image.mimeType,
                      width: image.width,
                      height: image.height,
                    },
                  ],
                }
              : {}),
          },
        ],
        streaming: true,
        lastActivityAt: Date.now(),
      }));
      useProjectDataStore.getState().setStreaming(session.projectId, sessionId, true);
      runtime.sendMessage(content, image);
      return true;
    },

    abort(sessionId) {
      const session = get().sessions[sessionId];
      if (!session || !runtimes.get(sessionId)?.abort()) {
        if (session) setStreamingAndNotify(sessionId, session.projectId, false);
        return;
      }
      setStreamingAndNotify(sessionId, session.projectId, false);
    },

    respondApproval(sessionId, requestId, approved) {
      runtimes.get(sessionId)?.respondApproval(requestId, approved);
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
      const session = get().sessions[sessionId];
      if (!session || session.loadingMore || !session.hasMore || session.oldestLoadedId === null) return;
      updateSession(sessionId, (s) => ({ ...s, loadingMore: true }));
      client.getSessionMessagesPage(agentId, sessionId, { turns: 10, before: session.oldestLoadedId })
        .then((result) => {
          const historyMessages = parseHistoryMessages(result.entries);
          updateSession(sessionId, (s) => {
            const messages = mergeHistoryMessages(s.messages, historyMessages);
            return {
              ...s,
              messages,
              hasMore: result.hasMore,
              oldestLoadedId: result.oldestId,
              loadingMore: false,
            };
          });
        })
        .catch((err: unknown) => {
          console.warn("[streaming-store] failed to load more history:", err);
          updateSession(sessionId, (s) => ({ ...s, loadingMore: false }));
        });
    },

    refreshHistory(client, agentId, sessionId) {
      const session = get().sessions[sessionId];
      if (!session || session.streaming) return;
      client.getSessionMessagesPage(agentId, sessionId, { turns: 10 })
        .then((result) => {
          const historyMessages = parseHistoryMessages(result.entries);
          updateSession(sessionId, (s) => {
            if (s.streaming) return s;
            const messages = mergeHistoryMessages(s.messages, historyMessages);
            return {
              ...s,
              messages,
              hasMore: result.hasMore,
              oldestLoadedId: result.oldestId,
              historyStatus: "ready",
            };
          });
        })
        .catch((err: unknown) => {
          console.warn("[streaming-store] failed to refresh session history:", err);
        });
    },
  };
});

export { parseHistoryMessages } from "../model/chat-history";
export { appendErrorMessage } from "../model/chat-session-reducer";
export type { StreamingSessionData } from "../model/chat-session-reducer";
