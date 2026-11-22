import { create } from "zustand";
import { parseBusServerMessage, parseBusScope, busScope, type BusChannelScope } from "@spherse/contracts";
import type { HostBridge } from "../lib/host-bridge";
import type { RpcClient } from "@spherse/rpc";
import { buildWsUrl } from "../lib/api";
import { WsConnection, type WsConnectionState } from "../lib/ws/ws-connection";
import { isRpcClientEnabled } from "../lib/rpc/enabled";
import { getSharedRpcClient } from "../lib/rpc/shared";

export type BusChannel = "trigger" | "agent" | "session" | "fs-watch" | "debug";
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

interface RpcBusDispatcher {
  dispatch: (event: { event: string; payload: unknown }) => void;
  removeEvent: () => void;
}

interface RpcBusBinding {
  client: RpcClient;
  dispatchers: Map<string, RpcBusDispatcher>;
  removeClosed: (() => void) | undefined;
  removeReopen: (() => void) | undefined;
}

let rpcBinding: RpcBusBinding | null = null;

function keyFor(projectId: string, channel: BusChannel): string {
  return `${projectId}::${channel}`;
}

function sendRaw(msg: unknown): void {
  connection?.send(JSON.stringify(msg));
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

function dispatchRpcEvent(scope: string, type: string, payload: unknown): void {
  const bus = parseBusScope(scope);
  if (!bus) return;
  const subs = handlers.get(keyFor(bus.projectId, bus.channel as BusChannel));
  if (subs) {
    for (const h of subs) h(type, payload);
  }
}

async function initRpcBus(
  set: (partial: Partial<BusStore>) => void,
  bridge: HostBridge,
): Promise<void> {
  const baseUrl = await bridge.getServerBaseUrl();
  if (!baseUrl) return;
  const token = (await bridge.getServerAccessToken?.()) ?? null;
  const client = getSharedRpcClient(baseUrl, () => token);
  rpcBinding = {
    client,
    dispatchers: new Map(),
    removeClosed: undefined,
    removeReopen: undefined,
  };
  rpcBinding.removeClosed = client.onClosed(() => {
    set({ status: "closed" });
  });
  rpcBinding.removeReopen = client.onReopen(() => {
    set({ status: "open", resumedAt: Date.now() });
    for (const scope of rpcBinding!.dispatchers.keys()) {
      void client.subscribe(scope).catch(() => {});
    }
  });
  set({ status: "connecting" });
  await client.connect();
  set({ status: "open", resumedAt: Date.now() });
}

function teardownRpcBus(): void {
  if (!rpcBinding) return;
  for (const scope of rpcBinding.dispatchers.keys()) {
    rpcBinding.client.unsubscribe(scope);
  }
  rpcBinding.removeClosed?.();
  rpcBinding.removeReopen?.();
  rpcBinding = null;
}

export const useBusStore = create<BusStore>((set) => ({
  status: "idle",
  resumedAt: null,

  async init(bridge) {
    if (isRpcClientEnabled()) {
      if (rpcBinding) return;
      await initRpcBus(set, bridge);
      return;
    }
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
    if (rpcBinding) {
      void rpcBinding.client.connect().catch(() => {});
      return;
    }
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
    if (wasEmpty) {
      if (rpcBinding) {
        const scope = channel === "debug" ? busScope("__global__", "debug") : busScope(projectId, channel as BusChannelScope);
        const dispatch = (event: { event: string; payload: unknown }) =>
          dispatchRpcEvent(scope, event.event, event.payload);
        const removeEvent = rpcBinding.client.onEvent(scope, dispatch);
        rpcBinding.dispatchers.set(scope, { dispatch, removeEvent });
        void rpcBinding.client.subscribe(scope).catch(() => {});
        return;
      }
      sendRaw({ kind: "subscribe", projectId, channel });
    }
  },

  removeHandler(projectId, channel, handler) {
    const key = keyFor(projectId, channel);
    const subs = handlers.get(key);
    if (!subs) return;
    subs.delete(handler);
    if (subs.size === 0) {
      handlers.delete(key);
      if (rpcBinding) {
        const scope = channel === "debug" ? busScope("__global__", "debug") : busScope(projectId, channel as BusChannelScope);
        const dispatcher = rpcBinding.dispatchers.get(scope);
        if (dispatcher) {
          rpcBinding.client.unsubscribe(scope);
          dispatcher.removeEvent();
          rpcBinding.dispatchers.delete(scope);
        }
        return;
      }
      sendRaw({ kind: "unsubscribe", projectId, channel });
    }
  },

  emitAgentTriggerEvent(projectId, eventName, payload) {
    if (rpcBinding) {
      void rpcBinding.client
        .call("bus.emitTriggerEvent", { projectId, eventName, ...(payload !== undefined ? { payload } : {}) })
        .catch((err: unknown) => {
          console.warn("[bus-store] emit trigger event failed:", err);
        });
      return;
    }
    sendRaw({ kind: "emit-trigger-event", projectId, eventName, payload });
  },

  teardown() {
    teardownRpcBus();
    connection?.close();
    connection = null;
    handlers.clear();
    set({ status: "idle", resumedAt: null });
  },
}));

function replaySubscriptions(): void {
  for (const key of handlers.keys()) {
    const sep = key.indexOf("::");
    const projectId = key.slice(0, sep);
    const channel = key.slice(sep + 2) as BusChannel;
    sendRaw({ kind: "subscribe", projectId, channel });
  }
}
