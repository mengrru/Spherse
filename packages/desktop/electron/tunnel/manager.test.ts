import { describe, expect, it, vi } from "vitest";
import { TunnelManager } from "./manager.js";
import type { TunnelProvider, TunnelSession } from "./provider.js";

function createFakeProvider(opts: { url?: string; failWith?: Error } = {}): TunnelProvider & {
  startMock: ReturnType<typeof vi.fn>;
} {
  const startMock = vi.fn(async (): Promise<TunnelSession> => {
    if (opts.failWith) throw opts.failWith;
    const listeners = new Set<() => void>();
    const stopped = { value: false };
    return {
      publicUrl: opts.url ?? "https://tunnel.example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      onStop: (fn: () => void) => listeners.add(fn),
      stop: async () => {
        if (stopped.value) return;
        stopped.value = true;
        for (const fn of listeners) {
          try { fn(); } catch { /* ignore */ }
        }
        listeners.clear();
      },
    };
  });
  return { id: "fake", start: startMock, startMock };
}

describe("TunnelManager", () => {
  it("starts and reports running state", async () => {
    const provider = createFakeProvider({ url: "https://abc.trycloudflare.com" });
    const manager = new TunnelManager(provider);
    const state = await manager.start(5173);
    expect(state).toMatchObject({
      status: "running",
      publicUrl: "https://abc.trycloudflare.com",
      startedAt: expect.any(String),
      error: null,
    });
    expect(provider.startMock).toHaveBeenCalledWith(5173);
  });

  it("reports error when provider rejects", async () => {
    const provider = createFakeProvider({ failWith: new Error("boom") });
    const manager = new TunnelManager(provider);
    const state = await manager.start(5173);
    expect(state.status).toBe("error");
    expect(state.error).toBe("boom");
    expect(state.publicUrl).toBeNull();
  });

  it("notifies listeners on state change", async () => {
    const provider = createFakeProvider();
    const manager = new TunnelManager(provider);
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.start(5173);
    expect(listener).toHaveBeenCalled();
    const lastCall = listener.mock.calls.at(-1)?.[0];
    expect(lastCall.status).toBe("running");
  });

  it("stop transitions back to stopped", async () => {
    const provider = createFakeProvider();
    const manager = new TunnelManager(provider);
    await manager.start(5173);
    const state = await manager.stop();
    expect(state.status).toBe("stopped");
    expect(state.publicUrl).toBeNull();
  });

  it("restart stops then starts", async () => {
    const provider = createFakeProvider({ url: "https://second.trycloudflare.com" });
    const manager = new TunnelManager(provider);
    await manager.start(5173);
    expect(manager.getState().status).toBe("running");
    const state = await manager.restart(5173);
    expect(state.status).toBe("running");
    expect(state.publicUrl).toBe("https://second.trycloudflare.com");
    expect(provider.startMock).toHaveBeenCalledTimes(2);
  });
});
