import { create } from "zustand";
import { parseChatServerEvent } from "@spherse/server/contracts";
import type { ApiClient } from "../../lib/api";
import type { AgentEvent } from "../../lib/types";
import {
  mergeHistoryMessages,
  parseHistoryMessages,
  reduceSessionEvents,
  type StreamingSessionData,
} from "./chat-session-reducer";

interface StreamingSession extends StreamingSessionData {
  ws: WebSocket | null;
  attachedCount: number;
  initialMessageSent: boolean;
}

interface StreamingStoreState {
  sessions: Record<string, StreamingSession>;
}

interface StreamingStoreActions {
  attach: (client: ApiClient, sessionId: string, port: number, initialMessage?: string) => void;
  detach: (sessionId: string) => void;
  disconnect: (sessionId: string) => void;
  touch: (sessionId: string) => void;
  sendMessage: (sessionId: string, text: string) => void;
  abort: (sessionId: string) => void;
  setScrollPosition: (sessionId: string, position: number) => void;
  cleanupExpired: (ttlMs: number) => void;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

export const useStreamingStore = create<StreamingStoreState & StreamingStoreActions>((set, get) => {
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;
  const pendingCreation = new Set<string>();
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
        next[sessionId] = { ...session, ...reduced };
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

  function ensureSession(sessionId: string, attachedDelta: number) {
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
        ws: null,
        messages: [],
        streaming: false,
        lastActivityAt: Date.now(),
        scrollPosition: 0,
        attachedCount: Math.max(0, attachedDelta),
        initialMessageSent: false,
      };
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: session,
        },
      };
    });
  }

  function connect(client: ApiClient, sessionId: string, port: number, initialMessage?: string) {
    if (pendingCreation.has(sessionId)) return;
    pendingCreation.add(sessionId);

    try {
      const current = get().sessions[sessionId];
      if (current?.ws && current.ws.readyState <= WebSocket.OPEN) return;
      if (current?.ws) {
        try { current.ws.close(); } catch { /* already closed */ }
      }

      const ws = new WebSocket(`ws://localhost:${port}/ws/chat/${sessionId}`);

      ws.onmessage = (wsEvent) => {
        if (get().sessions[sessionId]?.ws !== ws) return;
        try {
          const raw = JSON.parse(wsEvent.data);
          const parsed = parseChatServerEvent(raw) as AgentEvent;
          enqueueEvent(sessionId, parsed);
        } catch (err) {
          console.warn("[streaming-store] unparseable ws event:", err);
        }
      };

      ws.onerror = () => {
        if (get().sessions[sessionId]?.ws !== ws) return;
        enqueueEvent(sessionId, { type: "error", message: "WebSocket connection error" });
      };

      ws.onclose = () => {
        const currentSession = get().sessions[sessionId];
        if (currentSession?.ws !== ws) return;
        updateSession(sessionId, (session) => {
          if (session.ws === null && !session.streaming) return session;
          return { ...session, ws: null, streaming: false };
        });
      };

      ws.onopen = () => {
        if (!initialMessage) return;
        let shouldSend = false;
        updateSession(sessionId, (session) => {
          if (session.initialMessageSent) return session;
          shouldSend = true;
          return {
            ...session,
            messages: [...session.messages, { role: "user", content: initialMessage }],
            streaming: true,
            lastActivityAt: Date.now(),
            initialMessageSent: true,
          };
        });
        if (shouldSend && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "message", content: initialMessage }));
        }
      };

      updateSession(sessionId, (session) => ({ ...session, ws }));

      client.getSessionMessages(sessionId).then((history: any[]) => {
        const historyMessages = parseHistoryMessages(history);
        updateSession(sessionId, (session) => {
          const messages = mergeHistoryMessages(session.messages, historyMessages);
          return messages === session.messages ? session : { ...session, messages };
        });
      }).catch((err: unknown) => {
        console.warn("[streaming-store] failed to load session history:", err);
      });
    } finally {
      pendingCreation.delete(sessionId);
      startCleanupTimer();
    }
  }

  return {
    sessions: {},

    attach(client, sessionId, port, initialMessage) {
      ensureSession(sessionId, 1);
      connect(client, sessionId, port, initialMessage);
    },

    detach(sessionId) {
      updateSession(sessionId, (session) => ({
        ...session,
        attachedCount: Math.max(0, session.attachedCount - 1),
        lastActivityAt: Date.now(),
      }));
    },

    disconnect(sessionId) {
      eventQueue.delete(sessionId);
      const session = get().sessions[sessionId];
      if (session?.ws) {
        try { session.ws.close(); } catch { /* already closed */ }
      }
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

    sendMessage(sessionId, text) {
      const session = get().sessions[sessionId];
      if (!session?.ws || session.ws.readyState !== WebSocket.OPEN) return;
      const content = text.trim();
      if (!content || session.streaming) return;
      updateSession(sessionId, (current) => ({
        ...current,
        messages: [...current.messages, { role: "user", content }],
        streaming: true,
        lastActivityAt: Date.now(),
      }));
      session.ws.send(JSON.stringify({ type: "message", content }));
    },

    abort(sessionId) {
      const session = get().sessions[sessionId];
      if (!session?.ws || session.ws.readyState !== WebSocket.OPEN) {
        updateSession(sessionId, (current) => current.streaming ? { ...current, streaming: false } : current);
        return;
      }
      session.ws.send(JSON.stringify({ type: "abort" }));
      updateSession(sessionId, (current) => current.streaming ? { ...current, streaming: false } : current);
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
  };
});

export { appendErrorMessage, parseHistoryMessages } from "./chat-session-reducer";
export type { StreamingSessionData } from "./chat-session-reducer";
