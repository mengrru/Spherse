import { create } from "zustand";
import { parseBusServerMessage } from "@spherse/server/contracts";
import type { HostBridge } from "../lib/host-bridge";
import { buildWsUrl } from "../lib/api";

export type BusChannel = "trigger" | "agent" | "fs-watch" | "debug";
export type BusStatus = "idle" | "connecting" | "open" | "closed";
export type BusHandler = (type: string, payload: unknown) => void;

interface BusStore {
  status: BusStatus;
  /** Timestamp of the last successful (re)connection; null before the first connection. */
  resumedAt: number | null;
  init: (bridge: HostBridge) => Promise<void>;
  resumeProbe: () => void;
  addHandler: (projectId: string, channel: BusChannel, handler: BusHandler) => void;
  removeHandler: (projectId: string, channel: BusChannel, handler: BusHandler) => void;
  emitAgentTriggerEvent: (projectId: string, eventName: string, payload?: string) => void;
  teardown: () => void;
}

const RECONNECT_BACKOFFS = [1000, 2000, 5000, 10000, 30000];
const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 60000;
const RESUME_PROBE_TIMEOUT_MS = 5000;
const DEBUG_KEY = "__global__::debug";

let ws: WebSocket | null = null;
const handlers = new Map<string, Set<BusHandler>>();
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let probeTimer: ReturnType<typeof setTimeout> | undefined;
let lastPongAt = 0;
let reconnectAttempt = 0;
let activeBridge: HostBridge | null = null;

function keyFor(projectId: string, channel: BusChannel): string {
  return `${projectId}::${channel}`;
}

function sendRaw(msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* ws closed concurrently */ }
  }
}

function sendSubscribe(projectId: string, channel: BusChannel): void {
  sendRaw({ kind: "subscribe", projectId, channel });
}

function sendUnsubscribe(projectId: string, channel: BusChannel): void {
  sendRaw({ kind: "unsubscribe", projectId, channel });
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

function clearHeartbeatTimer(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

function clearProbeTimer(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = undefined;
  }
}

function startHeartbeat(): void {
  clearHeartbeatTimer();
  lastPongAt = Date.now();
  heartbeatTimer = setInterval(() => {
    sendRaw({ kind: "ping" });
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      if (ws) {
        try { ws.close(); } catch { /* already closed */ }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function replaySubscriptions(): void {
  for (const key of handlers.keys()) {
    const sep = key.indexOf("::");
    const projectId = key.slice(0, sep);
    const channel = key.slice(sep + 2) as BusChannel;
    sendSubscribe(projectId, channel);
  }
}

export const useBusStore = create<BusStore>((set, get) => {
  function scheduleReconnect(): void {
    set({ status: "connecting" });
    clearReconnectTimer();
    const delay = RECONNECT_BACKOFFS[Math.min(reconnectAttempt, RECONNECT_BACKOFFS.length - 1)];
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      if (activeBridge) void get().init(activeBridge);
    }, delay);
  }

  return {
    status: "idle",
    resumedAt: null,

    async init(bridge: HostBridge) {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      const baseUrl = await bridge.getServerBaseUrl();
      if (!baseUrl) {
        return;
      }
      set({ status: "connecting" });
      activeBridge = bridge;
      const accessToken = (await bridge.getServerAccessToken?.()) ?? null;
      const wsUrl = buildWsUrl(baseUrl, "/ws/bus", accessToken);
      const socket = new WebSocket(wsUrl);
      ws = socket;

      socket.onopen = () => {
        if (ws !== socket) return;
        reconnectAttempt = 0;
        set({ status: "open", resumedAt: Date.now() });
        replaySubscriptions();
        startHeartbeat();
      };

      socket.onmessage = (event) => {
        if (ws !== socket) return;
        let parsed;
        try {
          parsed = parseBusServerMessage(JSON.parse(event.data));
        } catch (err) {
          console.warn("[bus-store] unparseable ws message:", err);
          return;
        }
        if (parsed.channel === "__system__") {
          if (parsed.type === "pong") {
            lastPongAt = Date.now();
            clearProbeTimer();
          } else if (parsed.type === "fs_watch_error") {
            console.debug("[bus-store] fs_watch_error", parsed.payload);
          }
          return;
        }
        const key = parsed.channel === "debug" ? DEBUG_KEY : `${parsed.projectId}::${parsed.channel}`;
        const subs = handlers.get(key);
        if (subs) {
          for (const h of subs) h(parsed.type, parsed.payload);
        }
      };

      socket.onclose = () => {
        if (ws !== socket) return;
        clearHeartbeatTimer();
        scheduleReconnect();
      };

      socket.onerror = () => {
        /* onclose will follow; handled by onclose */
      };
    },

    /**
     * Actively probe the bus connection for liveness (e.g. after the host page
     * resumed from background suspension where iOS silently drops sockets
     * without firing onclose). If the socket is already stale it is closed
     * immediately so the existing reconnect/backoff path takes over; otherwise
     * a ping is sent and a short probe timeout closes the socket if no pong
     * arrives. No-op when the socket is not OPEN (the existing reconnect
     * machinery already owns that case).
     */
    resumeProbe() {
      clearProbeTimer();
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        try { ws.close(); } catch { /* already closed */ }
        return;
      }
      const pongAtStart = lastPongAt;
      sendRaw({ kind: "ping" });
      probeTimer = setTimeout(() => {
        probeTimer = undefined;
        if (ws && ws.readyState === WebSocket.OPEN && lastPongAt === pongAtStart) {
          try { ws.close(); } catch { /* already closed */ }
        }
      }, RESUME_PROBE_TIMEOUT_MS);
    },

    addHandler(projectId, channel, handler) {
      const key = keyFor(projectId, channel);
      let subs = handlers.get(key);
      const wasEmpty = !subs || subs.size === 0;
      if (!subs) {
        subs = new Set();
        handlers.set(key, subs);
      }
      subs.add(handler);
      if (wasEmpty) sendSubscribe(projectId, channel);
    },

    removeHandler(projectId, channel, handler) {
      const key = keyFor(projectId, channel);
      const subs = handlers.get(key);
      if (!subs) return;
      subs.delete(handler);
      if (subs.size === 0) {
        handlers.delete(key);
        sendUnsubscribe(projectId, channel);
      }
    },

    emitAgentTriggerEvent(projectId, eventName, payload) {
      sendRaw({ kind: "emit-trigger-event", projectId, eventName, payload });
    },

    teardown() {
      clearReconnectTimer();
      clearHeartbeatTimer();
      clearProbeTimer();
      if (ws) {
        try { ws.close(); } catch { /* already closed */ }
      }
      ws = null;
      handlers.clear();
      reconnectAttempt = 0;
      lastPongAt = 0;
      activeBridge = null;
      set({ status: "idle", resumedAt: null });
    },
  };
});
