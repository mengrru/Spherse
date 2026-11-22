import { parseRpcServerFrame, type RpcClientFrame, type RpcServerFrame } from "@spherse/contracts";
import type { RpcTransport } from "@spherse/rpc";

const READY_SIGNAL = "spherse-worker-ready";

class RuntimeWorker {
  private worker: SharedWorker | null = null;
  private readyPromise: Promise<void> | null = null;
  private readonly frameListeners = new Set<(frame: RpcServerFrame) => void>();
  private readonly closedListeners = new Set<() => void>();

  acquire(): { ready: Promise<void>; send: (message: RpcClientFrame) => void } {
    if (!this.worker) {
      const worker = new SharedWorker(new URL("../worker/index.ts", import.meta.url), {
        type: "module",
        name: "spherse-runtime",
      });
      this.worker = worker;
      worker.port.start();
      this.readyPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("spherse runtime worker boot timeout")), 30000);
        worker.port.addEventListener("message", (ev: MessageEvent) => {
          if ((ev.data as { type?: unknown })?.type === READY_SIGNAL) {
            clearTimeout(timer);
            resolve();
          }
        });
        worker.onerror = (err) => {
          clearTimeout(timer);
          reject(new Error(`spherse runtime worker failed: ${err.message ?? "unknown"}`));
        };
      });
      worker.port.addEventListener("message", (ev: MessageEvent) => {
        const parsed = typeof ev.data === "string" ? safeJsonParse(ev.data) : ev.data;
        if (!parsed || typeof parsed !== "object" || (parsed as { type?: unknown }).type === READY_SIGNAL) return;
        let frame: RpcServerFrame;
        try {
          frame = parseRpcServerFrame(parsed);
        } catch {
          return;
        }
        for (const listener of [...this.frameListeners]) listener(frame);
      });
    }
    return {
      ready: this.readyPromise!,
      send: (message) => this.worker?.port.postMessage(message),
    };
  }

  onFrame(listener: (frame: RpcServerFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onClosed(listener: () => void): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }
}

const runtimeWorker = new RuntimeWorker();

export class RpcSharedWorkerTransport implements RpcTransport {
  connect(): Promise<void> {
    return runtimeWorker.acquire().ready;
  }

  send(frame: RpcClientFrame): void {
    runtimeWorker.acquire().send(frame);
  }

  onFrame(handler: (frame: RpcServerFrame) => void): () => void {
    return runtimeWorker.onFrame(handler);
  }

  onClosed(handler: () => void): () => void {
    return runtimeWorker.onClosed(handler);
  }

  close(): void {
    /* worker lifetime is page-scoped */
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
