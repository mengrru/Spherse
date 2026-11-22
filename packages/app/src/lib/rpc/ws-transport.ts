import { isRpcPongFrame, parseRpcServerFrame, type RpcClientFrame, type RpcServerFrame } from "@spherse/contracts";
import { buildWsUrl } from "../api.js";
import { WsConnection } from "../ws/ws-connection.js";
import type { RpcTransport } from "@spherse/rpc";

export interface RpcWsTransportOptions {
  baseUrl: () => string | Promise<string>;
  accessToken?: () => string | Promise<string | null | undefined> | null;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
}

export class RpcWsTransport implements RpcTransport {
  private readonly connection: WsConnection;
  private readonly frameHandlers = new Set<(frame: RpcServerFrame) => void>();
  private readonly closedHandlers = new Set<() => void>();
  private readonly reopenHandlers = new Set<() => void>();
  private readonly openWaiters = new Set<{
    resolve: () => void;
    reject: (err: Error) => void;
  }>();
  private notifiedClosed = false;
  private openedOnce = false;

  constructor(options: RpcWsTransportOptions) {
    this.connection = new WsConnection(
      {
        url: async () => {
          const baseUrl = await options.baseUrl();
          if (!baseUrl) return "";
          const token = options.accessToken ? await options.accessToken() : null;
          return buildWsUrl(baseUrl, "/ws/rpc", token ?? null);
        },
        heartbeat: {
          pingIntervalMs: options.pingIntervalMs ?? 30000,
          pongTimeoutMs: options.pongTimeoutMs ?? 60000,
        },
        backoffMs: [1000, 2000, 5000, 10000, 30000],
        maxRetries: Infinity,
        fatalCloseCodes: new Set<number>(),
        probeTimeoutMs: 5000,
        pingPayload: JSON.stringify({ type: "ping" }),
        isPong: isRpcPongFrame,
        label: "rpc-ws",
      },
      {
        onMessage: (parsed) => {
          let frame: RpcServerFrame;
          try {
            frame = parseRpcServerFrame(parsed);
          } catch {
            return;
          }
          for (const handler of this.frameHandlers) handler(frame);
        },
        onStateChange: ({ state }) => {
          if (state === "open") {
            if (this.openedOnce) {
              for (const handler of this.reopenHandlers) handler();
            }
            this.openedOnce = true;
            this.notifiedClosed = false;
            for (const waiter of this.openWaiters) waiter.resolve();
            this.openWaiters.clear();
            return;
          }
          if (state === "closed" || state === "failed" || state === "fatal") {
            const error = new Error(`rpc transport ${state}`);
            for (const waiter of this.openWaiters) waiter.reject(error);
            this.openWaiters.clear();
            if (this.notifiedClosed) return;
            this.notifiedClosed = true;
            for (const handler of this.closedHandlers) handler();
          }
        },
      },
    );
  }

  connect(): Promise<void> {
    void this.connection.connect().catch(() => {});
    if (this.connection.getState() === "open") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.openWaiters.add({ resolve, reject });
    });
  }

  send(frame: RpcClientFrame): void {
    this.connection.send(JSON.stringify(frame));
  }

  onFrame(handler: (frame: RpcServerFrame) => void): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  onReopen(handler: () => void): () => void {
    this.reopenHandlers.add(handler);
    return () => this.reopenHandlers.delete(handler);
  }

  close(): void {
    this.connection.close();
  }
}
