import { create } from "zustand";
import type { ApiClient } from "../../lib/api";
import { useProjectDataStore } from "../../stores/project-data-store";
import { ChatRuntimeRegistry } from "./runtime/chat-runtime-registry";
import { ChatSessionRuntime } from "./runtime/chat-session-runtime";
import { deriveReplica, type DerivedView } from "./replica/derive";
import {
  addIntent,
  failIntent,
  removeIntent,
  setWithdrawInFlight,
} from "./replica/intents";
import { markRetrying } from "./replica/run-tail";
import {
  initialReplica,
  markIntentSending,
  planSend,
  queueInitialIntent,
  reduceReplica,
  type ReplicaFrame,
  type SessionReplica,
} from "./replica/session-replica";
import { runSync, type SyncKind } from "./replica/sync";
import { planRetry } from "./model/retry-plan";
import { lastWithdrawableUserIndex } from "./model/withdrawable";
import type { SendableImage } from "./types";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

export interface ReplicaSessionRecord {
  replica: SessionReplica;
  view: DerivedView;
  derivedFrom: SessionReplica | null;
  messages: DerivedView["messages"];
  streaming: boolean;
  hasMore: boolean;
  historyStatus: SessionReplica["historyStatus"];
  connectionStatus: SessionReplica["connectionStatus"];
  historyError: boolean;
  reconnectFailed: boolean;
  projectId: string;
  attachedCount: number;
  lastActivityAt: number;
  scrollPosition: number;
  loadingMore: boolean;
  initialQueued: boolean;
  client: ApiClient | null;
  agentId: string;
  generation: number;
  syncInFlight: boolean;
  resendPending: { content: string; attachment?: SendableImage } | null;
}

interface ReplicaStoreState {
  sessions: Record<string, ReplicaSessionRecord>;
}

interface ReplicaStoreActions {
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
  resync: (client: ApiClient, agentId: string, sessionId: string) => void;
  respondApproval: (sessionId: string, requestId: string, approved: boolean) => boolean;
  respondQuestion: (sessionId: string, requestId: string, answer: string) => boolean;
  setScrollPosition: (sessionId: string, position: number) => void;
  cleanupExpired: (ttlMs: number) => void;
  loadMore: (client: ApiClient, sessionId: string, agentId: string) => void;
}

export const useReplicaStore = create<ReplicaStoreState & ReplicaStoreActions>((set, get) => {
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;
  const runtimes = new ChatRuntimeRegistry();
  const frameQueue = new Map<string, ReplicaFrame[]>();
  let flushRaf: number | undefined;
  let generationCounter = 0;

  function materialize(
    record: ReplicaSessionRecord,
    replica: SessionReplica,
    view: DerivedView,
    now: number,
  ): ReplicaSessionRecord {
    return {
      ...record,
      replica,
      view,
      derivedFrom: replica,
      messages: view.messages,
      streaming: view.streaming,
      hasMore: replica.durable.hasMore,
      historyStatus: replica.historyStatus,
      connectionStatus: replica.connectionStatus,
      historyError: replica.historyError,
      reconnectFailed: replica.reconnectFailed,
      lastActivityAt: now,
    };
  }

  function commitReplica(
    sessionId: string,
    replica: SessionReplica,
    extras?: Partial<ReplicaSessionRecord>,
  ): void {
    const prev = get().sessions[sessionId];
    if (!prev) return;
    const view = prev.derivedFrom === replica ? prev.view : deriveReplica(replica);
    set((state) => {
      const current = state.sessions[sessionId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...materialize(current, replica, view, Date.now()), ...extras },
        },
      };
    });
    if (view.streaming !== prev.view.streaming) {
      notifyStreaming(prev.projectId, sessionId, view.streaming);
    }
  }

  function notifyStreaming(projectId: string, sessionId: string, streaming: boolean) {
    useProjectDataStore.getState().setStreaming(projectId, sessionId, streaming);
  }

  function flushQueuedFrames() {
    flushRaf = undefined;
    if (frameQueue.size === 0) return;
    const queued = new Map(frameQueue);
    frameQueue.clear();

    const streamingNotifications: Array<{ projectId: string; sessionId: string; streaming: boolean }> = [];
    const replayTargets = new Set<string>();
    const violationTargets = new Set<string>();

    set((state) => {
      const now = Date.now();
      const next = { ...state.sessions };
      let changed = false;

      for (const [sessionId, frames] of queued) {
        const record = next[sessionId];
        if (!record) continue;
        let replica = record.replica;
        let sawReplayCompleted = false;
        for (const frame of frames) {
          replica = reduceReplica(replica, frame, now);
          if (frame.type === "replayCompleted") sawReplayCompleted = true;
        }
        const view = record.derivedFrom === replica ? record.view : deriveReplica(replica);
        if (view.streaming !== record.view.streaming) {
          streamingNotifications.push({ projectId: record.projectId, sessionId, streaming: view.streaming });
        }
        if (sawReplayCompleted) {
          replayTargets.add(sessionId);
        }
        if (replica.durable.resyncNeeded) {
          violationTargets.add(sessionId);
        }
        if (replica !== record.replica) {
          next[sessionId] = materialize(record, replica, view, now);
          changed = true;
        }
      }

      return changed ? { sessions: next } : state;
    });

    for (const { projectId, sessionId, streaming } of streamingNotifications) {
      notifyStreaming(projectId, sessionId, streaming);
    }
    for (const sessionId of replayTargets) {
      startSync(sessionId, "replay");
    }
    for (const sessionId of violationTargets) {
      startSync(sessionId, "violation");
    }
    flushQueuedIntentSends();
    flushResendPending();
  }

  function enqueueFrame(sessionId: string, frame: ReplicaFrame) {
    if (!get().sessions[sessionId]) return;
    let queue = frameQueue.get(sessionId);
    if (!queue) {
      queue = [];
      frameQueue.set(sessionId, queue);
    }
    queue.push(frame);
    if (frame.type === "disconnected") {
      if (flushRaf !== undefined) {
        cancelAnimationFrame(flushRaf);
      }
      flushQueuedFrames();
      return;
    }
    if (flushRaf === undefined) {
      flushRaf = requestAnimationFrame(flushQueuedFrames);
    }
  }

  function flushQueuedIntentSends() {
    for (const [sessionId, record] of Object.entries(get().sessions)) {
      if (record.replica.connectionStatus !== "open") continue;
      const queuedIntents = record.replica.pending.intents.filter((intent) => intent.state === "queued");
      if (queuedIntents.length === 0) continue;
      const runtime = runtimes.get(sessionId);
      let pending = record.replica.pending;
      for (const intent of queuedIntents) {
        pending = markIntentSending(pending, intent.intentId);
        const delivered = runtime?.sendMessage(intent.content, intent.attachment, intent.intentId) ?? false;
        if (!delivered) {
          pending = failIntent(pending, intent.intentId);
        }
      }
      commitReplica(sessionId, { ...record.replica, pending });
    }
  }

  function flushResendPending() {
    for (const [sessionId, record] of Object.entries(get().sessions)) {
      if (!record.resendPending) continue;
      if (record.replica.pending.withdrawInFlight) continue;
      const payload = record.resendPending;
      commitReplica(sessionId, record.replica, { resendPending: null });
      executeSend(sessionId, payload.content, payload.attachment);
    }
  }

  function executeSend(sessionId: string, content: string, attachment?: SendableImage): boolean {
    const record = get().sessions[sessionId];
    if (!record) return false;
    const runtime = runtimes.get(sessionId);
    const plan = planSend(record.replica, {
      content,
      attachment,
      intentId: crypto.randomUUID(),
      socketOpen: runtime?.isOpen() ?? false,
      now: Date.now(),
    });
    if (!plan) return false;
    let replica = { ...record.replica, pending: addIntent(record.replica.pending, plan.intent) };
    if (plan.frame) {
      const delivered = runtime?.sendMessage(content, attachment, plan.intent.intentId) ?? false;
      if (!delivered) {
        replica = { ...replica, pending: failIntent(replica.pending, plan.intent.intentId) };
      }
    }
    commitReplica(sessionId, replica);
    return true;
  }

  function startSync(sessionId: string, trigger: "replay" | "manual" | "violation") {
    const record = get().sessions[sessionId];
    if (!record || record.syncInFlight) return;
    const client = record.client;
    if (!client) return;

    let kind: SyncKind;
    if (trigger === "replay") {
      kind = !record.replica.everReady ? "initial" : "catchup";
    } else if (trigger === "violation") {
      kind = "full";
    } else {
      if (record.view.streaming) return;
      kind = "refresh";
    }

    const generation = record.generation;
    set((state) => {
      const current = state.sessions[sessionId];
      if (!current || current.syncInFlight) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...current, syncInFlight: true },
        },
      };
    });
    if (!get().sessions[sessionId]?.syncInFlight) return;

    const deps = {
      client,
      agentId: record.agentId,
      sessionId,
      emit: (frame: ReplicaFrame) => {
        if (frame.type === "message_settled" || frame.type === "turn_withdrawn" || frame.type === "turn_retried") {
          enqueueFrame(sessionId, { type: "syncSettled", frame });
          return;
        }
        enqueueFrame(sessionId, frame);
      },
      getState: () => {
        const current = get().sessions[sessionId];
        return current && current.generation === generation ? current.replica : undefined;
      },
      isRecordActive: () => {
        const current = get().sessions[sessionId];
        return current !== undefined && current.generation === generation;
      },
    };
    void runSync(deps, kind).finally(() => {
      set((state) => {
        const current = state.sessions[sessionId];
        if (!current || current.generation !== generation) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: { ...current, syncInFlight: false },
          },
        };
      });
      if (get().sessions[sessionId]?.replica.durable.resyncNeeded) {
        startSync(sessionId, "violation");
      }
    });
  }

  function connectRuntime(
    sessionId: string,
    baseUrl: string,
    projectId: string,
    agentId: string,
    accessToken: string | null,
  ) {
    let runtime = runtimes.get(sessionId);
    if (!runtime) {
      runtime = new ChatSessionRuntime(sessionId, {
        onFrame: (frame) => enqueueFrame(sessionId, frame),
        isActive: () => !!get().sessions[sessionId],
        shouldReconnect: () => (get().sessions[sessionId]?.attachedCount ?? 0) > 0,
      });
      runtimes.set(sessionId, runtime);
    }
    runtime.connect({ baseUrl, projectId, agentId, accessToken });
  }

  function ensureSession(sessionId: string, attachedDelta: number, projectId: string, client: ApiClient, agentId: string) {
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
              client,
              agentId,
            },
          },
        };
      }
      generationCounter += 1;
      const replica = initialReplica();
      const view = deriveReplica(replica);
      const record: ReplicaSessionRecord = {
        replica,
        view,
        derivedFrom: replica,
        messages: view.messages,
        streaming: view.streaming,
        hasMore: replica.durable.hasMore,
        historyStatus: replica.historyStatus,
        connectionStatus: replica.connectionStatus,
        historyError: replica.historyError,
        reconnectFailed: replica.reconnectFailed,
        projectId,
        attachedCount: Math.max(0, attachedDelta),
        lastActivityAt: Date.now(),
        scrollPosition: 0,
        loadingMore: false,
        initialQueued: false,
        client,
        agentId,
        generation: generationCounter,
        syncInFlight: false,
        resendPending: null,
      };
      return { sessions: { ...state.sessions, [sessionId]: record } };
    });
  }

  function updateRecordMeta(sessionId: string, client: ApiClient, agentId: string): boolean {
    set((state) => {
      const record = state.sessions[sessionId];
      if (!record) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...record, client, agentId },
        },
      };
    });
    return !!get().sessions[sessionId];
  }

  function startCleanupTimer() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
      get().cleanupExpired(DEFAULT_TTL_MS);
    }, CLEANUP_INTERVAL_MS);
  }

  return {
    sessions: {},

    attach(client, sessionId, baseUrl, projectId, agentId, initialMessage, accessToken) {
      ensureSession(sessionId, 1, projectId, client, agentId);
      const record = get().sessions[sessionId];
      if (record && initialMessage && initialMessage.trim() && !record.initialQueued) {
        const queued = queueInitialIntent(record.replica, {
          content: initialMessage,
          intentId: crypto.randomUUID(),
          now: Date.now(),
        });
        commitReplica(sessionId, queued.state, { initialQueued: true });
      }
      connectRuntime(sessionId, baseUrl, projectId, agentId, accessToken ?? null);
      startCleanupTimer();
    },

    detach(sessionId) {
      set((state) => {
        const record = state.sessions[sessionId];
        if (!record) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: { ...record, attachedCount: Math.max(0, record.attachedCount - 1), lastActivityAt: Date.now() },
          },
        };
      });
    },

    disconnect(sessionId) {
      runtimes.delete(sessionId);
      frameQueue.delete(sessionId);
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
        .filter(([, record]) => record.projectId === projectId)
        .map(([sessionId]) => sessionId);
      for (const sessionId of sessionIds) {
        get().disconnect(sessionId);
      }
    },

    touch(sessionId) {
      set((state) => {
        const record = state.sessions[sessionId];
        if (!record) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...record, lastActivityAt: Date.now() } } };
      });
    },

    sendMessage(sessionId, text, image) {
      const record = get().sessions[sessionId];
      if (!record) return false;
      const content = text.trim();
      if (!content || record.view.streaming) return false;
      return executeSend(sessionId, content, image);
    },

    retry(sessionId) {
      const record = get().sessions[sessionId];
      const runtime = runtimes.get(sessionId);
      if (!record || record.view.streaming || !runtime?.isOpen()) return;
      const plan = planRetry(record.view.messages);
      if (plan.kind === "none") return;

      if (plan.kind === "retry-last") {
        commitReplica(sessionId, { ...record.replica, run: markRetrying(record.replica.run) });
        runtime.retry();
        return;
      }

      if (plan.failedIntent) {
        const failed = [...record.replica.pending.intents].reverse().find((intent) => intent.state === "failed");
        if (failed) {
          commitReplica(sessionId, { ...record.replica, pending: removeIntent(record.replica.pending, failed.intentId) });
        }
        executeSend(sessionId, plan.content, plan.attachment);
        return;
      }

      const replica = { ...record.replica, pending: setWithdrawInFlight(record.replica.pending, true) };
      commitReplica(sessionId, replica, { resendPending: { content: plan.content, attachment: plan.attachment } });
      if (!runtime.withdraw()) {
        flushResendPending();
      }
    },

    withdrawLastTurn(sessionId) {
      const record = get().sessions[sessionId];
      if (!record || record.view.streaming) return;
      if (lastWithdrawableUserIndex(record.view.messages) < 0) return;
      const runtime = runtimes.get(sessionId);
      if (!runtime?.isOpen()) return;
      commitReplica(sessionId, {
        ...record.replica,
        pending: setWithdrawInFlight(record.replica.pending, true),
      });
      runtime.withdraw();
    },

    abort(sessionId) {
      const record = get().sessions[sessionId];
      if (!record) return;
      runtimes.get(sessionId)?.abort();
      commitReplica(sessionId, reduceReplica(record.replica, { type: "runKilled" }, Date.now()));
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
      for (const [sessionId, record] of Object.entries(get().sessions)) {
        if (record.attachedCount <= 0) continue;
        runtimes.get(sessionId)?.probe();
      }
    },

    retryHistory(client, agentId, sessionId) {
      if (!updateRecordMeta(sessionId, client, agentId)) return;
      const record = get().sessions[sessionId];
      if (record && record.replica.historyError) {
        commitReplica(sessionId, { ...record.replica, historyError: false });
      }
      startSync(sessionId, "manual");
    },

    resync(client, agentId, sessionId) {
      if (!updateRecordMeta(sessionId, client, agentId)) return;
      startSync(sessionId, "manual");
    },

    respondApproval(sessionId, requestId, approved) {
      return runtimes.get(sessionId)?.respondApproval(requestId, approved) ?? false;
    },

    respondQuestion(sessionId, requestId, answer) {
      return runtimes.get(sessionId)?.respondQuestion(requestId, answer) ?? false;
    },

    setScrollPosition(sessionId, position) {
      set((state) => {
        const record = state.sessions[sessionId];
        if (!record || record.scrollPosition === position) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...record, scrollPosition: position } } };
      });
    },

    cleanupExpired(ttlMs) {
      const now = Date.now();
      const sessions = get().sessions;
      for (const [sessionId, record] of Object.entries(sessions)) {
        if (!record.view.streaming && record.attachedCount === 0 && now - record.lastActivityAt > ttlMs) {
          get().disconnect(sessionId);
        }
      }
    },

    loadMore(client, sessionId, agentId) {
      const record = get().sessions[sessionId];
      if (!record || record.loadingMore || !record.replica.durable.hasMore || record.replica.durable.oldestLoadedId === null) return;
      const generation = record.generation;
      set((state) => {
        const current = state.sessions[sessionId];
        if (!current) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...current, loadingMore: true } } };
      });
      client.getSessionMessagesPage(agentId, sessionId, { limit: 20, before: record.replica.durable.oldestLoadedId })
        .then((result) => {
          const current = get().sessions[sessionId];
          if (!current || current.generation !== generation) return;
          commitReplica(sessionId, reduceReplica(current.replica, {
            type: "loadMoreApplied",
            page: {
              entries: result.entries.map((entry) => ({
                id: entry.id,
                message: entry.message as import("./replica/durable").DurableEntry["message"],
                ...(entry.source !== undefined ? { source: entry.source } : {}),
                ...(entry.triggerName !== undefined ? { triggerName: entry.triggerName } : {}),
              })),
              hasMore: result.hasMore,
              oldestId: result.oldestId,
            },
          }, Date.now()), { loadingMore: false });
        })
        .catch((err: unknown) => {
          console.warn("[replica-store] failed to load more history:", err);
          set((state) => {
            const current = state.sessions[sessionId];
            if (!current) return state;
            return { sessions: { ...state.sessions, [sessionId]: { ...current, loadingMore: false } } };
          });
        });
    },
  };
});
