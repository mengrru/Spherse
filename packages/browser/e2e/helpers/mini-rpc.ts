import type { Page } from "@playwright/test";

interface RpcWindow {
  __spherseMiniRpc?: {
    call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  };
}

export async function setupMiniRpc(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const scripts = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.endsWith(".js"));
    const mainUrl =
      scripts.find((n) => /\/assets\/main-[A-Za-z0-9_-]+\.js$/.test(n)) ??
      document.querySelector("script[type=module]")?.src;
    if (!mainUrl) throw new Error("main bundle url not found");
    const text = await (await fetch(mainUrl)).text();
    const match = text.match(/new URL\(""\+new URL\("([^"]+)",import\.meta\.url\)/);
    if (!match) throw new Error("worker ref not found in main bundle");
    const workerUrl = new URL(match[1], mainUrl).href;
    const worker = new SharedWorker(workerUrl, { type: "module" });
    worker.port.start();
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    worker.port.addEventListener("message", (ev: MessageEvent) => {
      const parsed = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      if (!parsed || typeof parsed !== "object" || parsed.type !== "result") return;
      const entry = pending.get(parsed.id);
      if (!entry) return;
      pending.delete(parsed.id);
      if (parsed.ok) entry.resolve(parsed.data);
      else entry.reject(new Error(`${parsed.method ?? "rpc"}: ${parsed.error?.message ?? "failed"}`));
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker boot timeout")), 30000);
      worker.port.addEventListener("message", (ev: MessageEvent) => {
        if ((ev.data as { type?: string })?.type === "spherse-worker-ready") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const w = window as RpcWindow;
    w.__spherseMiniRpc = {
      call: (method: string, params: Record<string, unknown> = {}) =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          worker.port.postMessage({ type: "call", id, method, params });
        }),
    };
  });
}

export async function rpcCall<T = unknown>(page: Page, method: string, params?: Record<string, unknown>): Promise<T> {
  return page.evaluate(
    ({ method, params }) => {
      const w = window as RpcWindow;
      if (!w.__spherseMiniRpc) throw new Error("mini rpc not initialized");
      return w.__spherseMiniRpc.call(method, params) as Promise<T>;
    },
    { method, params: params ?? {} },
  );
}
