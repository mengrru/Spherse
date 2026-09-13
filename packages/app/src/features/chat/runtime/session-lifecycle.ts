import type { AgentEvent } from "../model/agent-event-parse";
import { clearRun } from "../model/entry-reducer";
import { applyHistoryPage } from "../model/history-entries";
import { createHttpRecovery, type SessionRecovery } from "./session-recovery";
import {
  createSessionLink,
  type SessionLink,
  type SessionLinkParams,
} from "./session-link";
import type { ChatSessionState } from "./session-state";

interface SessionLinkRecord {
  link: SessionLink;
  params: SessionLinkParams;
}

export interface SessionLifecycleHost {
  getSession(sessionId: string): ChatSessionState | undefined;
  getSessions(): Record<string, ChatSessionState>;
  updateSession(sessionId: string, updater: (session: ChatSessionState) => ChatSessionState): void;
  removeSession(sessionId: string): void;
}

export interface SessionLifecycleDeps {
  onLinkOpen(sessionId: string): void;
  deliverEvents(sessionId: string, events: AgentEvent[]): void;
  cancelQueued(sessionId: string): void;
}

export interface SessionLifecycle {
  attach(params: SessionLinkParams): void;
  detach(sessionId: string): void;
  touch(sessionId: string): void;
  disconnect(sessionId: string): void;
  disconnectProject(projectId: string): void;
  cleanupExpired(ttlMs: number): void;
  reconnect(sessionId: string): void;
  resumeProbeAll(): void;
  getLink(sessionId: string): SessionLink | undefined;
  getInitialMessage(sessionId: string): string | undefined;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

export function createSessionLifecycle(
  host: SessionLifecycleHost,
  deps: SessionLifecycleDeps,
): SessionLifecycle {
  const links = new Map<string, SessionLinkRecord>();
  const recoveries = new Map<string, SessionRecovery>();
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;

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
        deps.onLinkOpen(sessionId);
      },
      onClose: () => {
        recoveries.get(sessionId)?.onClose();
      },
      onStateChange: (change) => {
        host.updateSession(sessionId, (session) => {
          const withConnection: ChatSessionState = {
            ...session,
            connection: {
              state: change.state,
              attempt: change.attempt,
              delayMs: change.delayMs,
              ...(change.closeCode !== undefined ? { closeCode: change.closeCode } : {}),
            },
          };
          return change.state === "fatal" ? clearRun(withConnection) : withConnection;
        });
      },
      onEvent: (event) => {
        const recovery = recoveries.get(sessionId);
        if (recovery?.onFrame(event)) return;
        deps.deliverEvents(sessionId, [event]);
      },
      isAttached: () => (host.getSession(sessionId)?.attachedCount ?? 0) > 0,
    });
    record.link = link;

    const recovery = createHttpRecovery({
      fetchPage: () => record.params.client.getSessionMessagesPage(
        record.params.agentId,
        sessionId,
        { limit: 20 },
      ),
      applyPage: (page) => {
        host.updateSession(sessionId, (session) => {
          const merged = applyHistoryPage(session, page, "latest");
          return {
            ...merged,
            history: { ...session.history, hasMore: page.hasMore, oldestSeq: page.oldestId },
          };
        });
      },
      emitEvents: (events) => deps.deliverEvents(sessionId, events),
      setHistory: (status, error) => {
        host.updateSession(sessionId, (session) => ({
          ...session,
          history: { ...session.history, status, error },
        }));
      },
      getHistoryStatus: () => host.getSession(sessionId)?.history.status ?? "pending",
      isAlive: () => host.getSession(sessionId) !== undefined && links.get(sessionId) === record,
    });

    links.set(sessionId, record);
    recoveries.set(sessionId, recovery);
    return link;
  }

  function startCleanupTimer(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
      disconnectExpired(DEFAULT_TTL_MS);
    }, CLEANUP_INTERVAL_MS);
  }

  function stopCleanupTimerIfEmpty(): void {
    if (links.size > 0 || !cleanupTimer) return;
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }

  function disconnect(sessionId: string): void {
    recoveries.get(sessionId)?.cancel();
    recoveries.delete(sessionId);
    links.get(sessionId)?.link.dispose();
    links.delete(sessionId);
    deps.cancelQueued(sessionId);
    host.removeSession(sessionId);
    stopCleanupTimerIfEmpty();
  }

  function disconnectExpired(ttlMs: number): void {
    const now = Date.now();
    for (const session of Object.values(host.getSessions())) {
      if (!session.streaming && session.attachedCount === 0 && now - session.lastActivityAt > ttlMs) {
        disconnect(session.sessionId);
      }
    }
  }

  return {
    attach(params) {
      const link = ensureLink(params);
      link.connect();
      startCleanupTimer();
    },

    detach(sessionId) {
      host.updateSession(sessionId, (session) => ({
        ...session,
        attachedCount: Math.max(0, session.attachedCount - 1),
        lastActivityAt: Date.now(),
      }));
    },

    touch(sessionId) {
      host.updateSession(sessionId, (session) => ({ ...session, lastActivityAt: Date.now() }));
    },

    disconnect,

    disconnectProject(projectId) {
      const sessionIds = Object.values(host.getSessions())
        .filter((session) => session.projectId === projectId)
        .map((session) => session.sessionId);
      for (const sessionId of sessionIds) {
        disconnect(sessionId);
      }
    },

    cleanupExpired(ttlMs) {
      disconnectExpired(ttlMs);
    },

    reconnect(sessionId) {
      links.get(sessionId)?.link.reconnect();
    },

    resumeProbeAll() {
      for (const session of Object.values(host.getSessions())) {
        if (session.attachedCount <= 0) continue;
        links.get(session.sessionId)?.link.probe();
      }
    },

    getLink(sessionId) {
      return links.get(sessionId)?.link;
    },

    getInitialMessage(sessionId) {
      return links.get(sessionId)?.params.initialMessage;
    },
  };
}
