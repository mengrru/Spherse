import type {
  RpcEventFrame,
  RpcServerFrame,
} from "@spherse/contracts";
import type { RpcTransport } from "./transport.js";

type PendingEntry = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export type RpcEventHandler = (event: RpcEventFrame) => void;

export interface SubscribeOptions {
  since?: number;
}

export class RpcClient {
  private nextId = 1;
  private readonly pendingCalls = new Map<number, PendingEntry>();
  private readonly pendingSubs = new Map<number, PendingEntry>();
  private readonly eventHandlers = new Map<string, Set<RpcEventHandler>>();
  private readonly activeSubs = new Map<string, SubscribeOptions>();
  private closed = false;
  private readonly frameHandler: (frame: RpcServerFrame) => void;
  private readonly closedHandler: () => void;
  private readonly removeFrameListener: () => void;
  private readonly removeClosedListener: () => void;

  constructor(private readonly transport: RpcTransport) {
    this.frameHandler = (frame) => this.handleFrame(frame);
    this.closedHandler = () => this.handleClosed();
    this.removeFrameListener = transport.onFrame(this.frameHandler);
    this.removeClosedListener = transport.onClosed(this.closedHandler);
  }

  connect(): Promise<void> {
    return this.transport.connect();
  }

  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("rpc client disposed"));
    const id = this.nextId++;
    this.transport.send({
      type: "call",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });
    return new Promise<T>((resolve, reject) => {
      this.pendingCalls.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
  }

  onEvent(scope: string, handler: RpcEventHandler): () => void {
    let set = this.eventHandlers.get(scope);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(scope, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.eventHandlers.delete(scope);
    };
  }

  subscribe(scope: string, options: SubscribeOptions = {}): Promise<void> {
    if (this.closed) return Promise.reject(new Error("rpc client disposed"));
    const id = this.nextId++;
    this.activeSubs.set(scope, options);
    this.transport.send({
      type: "sub",
      id,
      scope,
      ...(options.since !== undefined ? { since: options.since } : {}),
    });
    return new Promise<void>((resolve, reject) => {
      this.pendingSubs.set(id, { resolve: () => resolve(), reject });
    });
  }

  unsubscribe(scope: string): void {
    if (!this.activeSubs.has(scope)) return;
    this.activeSubs.delete(scope);
    const id = this.nextId++;
    this.transport.send({ type: "unsub", id, scope });
  }

  async resubscribeAll(): Promise<void> {
    await Promise.all(
      [...this.activeSubs.entries()].map(([scope, options]) => {
        const id = this.nextId++;
        this.transport.send({
          type: "sub",
          id,
          scope,
          ...(options.since !== undefined ? { since: options.since } : {}),
        });
        return new Promise<void>((resolve, reject) => {
          this.pendingSubs.set(id, { resolve: () => resolve(), reject });
        });
      }),
    );
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.removeFrameListener();
    this.removeClosedListener();
    this.failPending(new Error("rpc client disposed"));
    this.eventHandlers.clear();
    this.activeSubs.clear();
    this.transport.close();
  }

  private handleFrame(frame: RpcServerFrame): void {
    if (frame.type === "event") {
      this.dispatchEvent(frame);
      return;
    }
    if (frame.type === "snapshot") {
      for (const event of frame.events) this.dispatchEvent(event);
      this.pendingSubs.get(frame.id)?.resolve(undefined);
      this.pendingSubs.delete(frame.id);
      return;
    }
    if (frame.type === "result") {
      const sub = this.pendingSubs.get(frame.id);
      if (sub) {
        this.pendingSubs.delete(frame.id);
        if (!frame.ok) {
          sub.reject(new Error(frame.error?.message ?? "subscription failed"));
        } else {
          sub.resolve(undefined);
        }
        return;
      }
      const call = this.pendingCalls.get(frame.id);
      if (!call) return;
      this.pendingCalls.delete(frame.id);
      if (frame.ok) {
        call.resolve(frame.data);
      } else {
        call.reject(new Error(frame.error?.message ?? "rpc call failed"));
      }
      return;
    }
  }

  private dispatchEvent(event: RpcEventFrame): void {
    const set = this.eventHandlers.get(event.scope);
    if (!set) return;
    for (const handler of set) handler(event);
  }

  private handleClosed(): void {
    this.failPending(new Error("rpc transport closed"));
  }

  private failPending(error: Error): void {
    for (const [id, entry] of this.pendingCalls) {
      this.pendingCalls.delete(id);
      entry.reject(error);
    }
    for (const [id, entry] of this.pendingSubs) {
      this.pendingSubs.delete(id);
      entry.reject(error);
    }
  }
}
