import { create } from "zustand";
import { parseBusServerMessage } from "@spherse/contracts";
import type { HostBridge } from "../lib/host-bridge";
import { buildWsUrl } from "../lib/api";
import { WsConnection, type WsConnectionState } from "../lib/ws/ws-connection";

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

let connection: WsConnection | null = null;
const handlers = new Map<string, Set<BusHandler>>();

function keyFor(projectId: string, channel: BusChannel): string {
  return `${projectId}::${channel}`;
}

function sendRaw(msg: unknown): void {
  connection?.send(JSON.stringify(msg));
}

function replaySubscriptions(): void {
  for (const key of handlers.keys()) {
    const sep = key.indexOf("::");
    const projectId = key.slice(0, sep);
    const channel = key.slice(sep + 2) as BusChannel;
    sendRaw({ kind: "subscribe", projectId, channel });
  }
}

function dispatchMessage(parsed: unknown): void {
  let message;
  try {
    message = parseBusServerMessage(parsed);
  } catch (err) {
    console.warn("[bus-store] unparseable ws message:", err);
    return;
  }
  if (message.channel === "__system__") {
    if (message.type === "fs_watch_error") {
      console.debug("[bus-store] fs_watch_error", message.payload);
    }
    return;
  }
  const key = message.channel === "debug"
    ? DEBUG_KEY
    : `${message.projectId}::${message.channel}`;
  const subs = handlers.get(key);
  if (subs) {
    for (const h of subs) h(message.type, message.payload);
  }
}

function isActive(state: WsConnectionState): boolean {
  return state === "connecting" || state === "open" || state === "waiting-backoff";
}

export const useBusStore = create<BusStore>((set) => ({
  status: "idle",
  resumedAt: null,

  async init(bridge) {

    if (connection && isActive(connection.getState())) return;
    connection?.close();
    connection = new WsConnection(
      {
        url: async () => {
          const baseUrl = await bridge.getServerBaseUrl();
          if (!baseUrl) return "";
          const accessToken = (await bridge.getServerAccessToken?.()) ?? null;
          return buildWsUrl(baseUrl, "/ws/bus", accessToken);
        },
        heartbeat: { pingIntervalMs: HEARTBEAT_INTERVAL_MS, pongTimeoutMs: HEARTBEAT_TIMEOUT_MS },
        backoffMs: RECONNECT_BACKOFFS,
        maxRetries: Infinity,
        fatalCloseCodes: new Set<number>(),
        probeTimeoutMs: RESUME_PROBE_TIMEOUT_MS,
        pingPayload: JSON.stringify({ kind: "ping" }),
        isPong: (parsed) =>
          (parsed as { channel?: unknown })?.channel === "__system__" &&
          (parsed as { type?: unknown })?.type === "pong",
        label: "bus-ws",
      },
      {
        onMessage: dispatchMessage,
        onStateChange: ({ state }) => {
          if (state === "open") {
            set({ status: "open", resumedAt: Date.now() });
            replaySubscriptions();
          } else if (state === "connecting" || state === "waiting-backoff") {
            set({ status: "connecting" });
          }
        },
      },
    );
    await connection.connect();
  },

  resumeProbe() {
    connection?.probe();
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
    if (wasEmpty) sendRaw({ kind: "subscribe", projectId, channel });
  },

  removeHandler(projectId, channel, handler) {
    const key = keyFor(projectId, channel);
    const subs = handlers.get(key);
    if (!subs) return;
    subs.delete(handler);
    if (subs.size === 0) {
      handlers.delete(key);
      sendRaw({ kind: "unsubscribe", projectId, channel });
    }
  },

  emitAgentTriggerEvent(projectId, eventName, payload) {
    sendRaw({ kind: "emit-trigger-event", projectId, eventName, payload });
  },

  teardown() {
    connection?.close();
    connection = null;
    handlers.clear();

    set({ status: "idle", resumedAt: null });
  },
}));
