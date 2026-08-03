import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpherseRuntime } from "../runtime/context.js";

/**
 * context.ts holds module-level singleton state (`runtime`, `waiters`) because in a real
 * iframe the SDK loads exactly once. Each test re-imports a fresh module instance via
 * `vi.resetModules()` so state never leaks across tests. The `spherse:runtime` listener
 * is re-installed per instance; listeners accumulate on jsdom's `window`, but they run in
 * registration order (the current instance is registered last and wins any
 * `window.__SPHERSE__` write), so assertions reading the current instance stay correct.
 */

type ContextModule = typeof import("../runtime/context.js");

async function useContext(): Promise<ContextModule> {
  const mod = await import("../runtime/context.js");
  mod.installRuntimeListener();
  return mod;
}

function postRuntime(rt: Partial<SpherseRuntime> & { sessionId: string }): void {
  window.dispatchEvent(
    new MessageEvent("message", { data: { type: "spherse:runtime", ...rt } }),
  );
}

beforeEach(() => {
  vi.resetModules();
  delete (window as unknown as { __SPHERSE__?: unknown }).__SPHERSE__;
});

describe("seedFromInjectedGlobal", () => {
  it("seeds runtime when window.__SPHERSE__ has a sessionId", async () => {
    const { seedFromInjectedGlobal, peekRuntime } = await useContext();
    window.__SPHERSE__ = { sessionId: "s1", agentId: "a1", projectId: "p1" };
    seedFromInjectedGlobal();
    expect(peekRuntime()).toEqual({ sessionId: "s1", agentId: "a1", projectId: "p1" });
  });

  it("stays null when the injected global is absent or missing sessionId", async () => {
    const { seedFromInjectedGlobal, peekRuntime } = await useContext();
    seedFromInjectedGlobal();
    expect(peekRuntime()).toBeNull();

    (window as unknown as { __SPHERSE__?: unknown }).__SPHERSE__ = { agentId: "a1" };
    seedFromInjectedGlobal();
    expect(peekRuntime()).toBeNull();
  });
});

describe("installRuntimeListener (async path)", () => {
  it("seeds runtime from a spherse:runtime message and mirrors it to window.__SPHERSE__", async () => {
    const { peekRuntime } = await useContext();
    postRuntime({ sessionId: "s2", agentId: "a2", projectId: "p2" });
    expect(peekRuntime()).toEqual({ sessionId: "s2", agentId: "a2", projectId: "p2" });
    expect(window.__SPHERSE__).toEqual({ sessionId: "s2", agentId: "a2", projectId: "p2" });
  });

  it("ignores messages without a sessionId", async () => {
    const { peekRuntime } = await useContext();
    postRuntime({ agentId: "a2" });
    expect(peekRuntime()).toBeNull();
  });

  it("ignores unrelated message types", async () => {
    const { peekRuntime } = await useContext();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "something:else" } }));
    expect(peekRuntime()).toBeNull();
  });
});

describe("getRuntime", () => {
  it("resolves immediately when runtime is already seeded", async () => {
    const { seedFromInjectedGlobal, getRuntime } = await useContext();
    window.__SPHERSE__ = { sessionId: "s1" };
    seedFromInjectedGlobal();
    await expect(getRuntime()).resolves.toEqual({ sessionId: "s1" });
  });

  it("queues waiters and resolves them once the async message arrives", async () => {
    const { getRuntime, peekRuntime } = await useContext();
    const p = getRuntime();
    expect(peekRuntime()).toBeNull();

    postRuntime({ sessionId: "s3", agentId: "a3" });
    await expect(p).resolves.toEqual({ sessionId: "s3", agentId: "a3" });
    expect(peekRuntime()).toEqual({ sessionId: "s3", agentId: "a3" });
  });

  it("resolves all queued waiters on a single async message", async () => {
    const { getRuntime } = await useContext();
    const p1 = getRuntime();
    const p2 = getRuntime();
    postRuntime({ sessionId: "s4" });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ sessionId: "s4" });
    expect(r2).toEqual({ sessionId: "s4" });
  });

  it("resolves immediately when seeded after a waiter was queued", async () => {
    const { getRuntime } = await useContext();
    const p = getRuntime();
    postRuntime({ sessionId: "s5" });
    await expect(p).resolves.toEqual({ sessionId: "s5" });
    // A second call after seeding must still resolve immediately.
    await expect(getRuntime()).resolves.toEqual({ sessionId: "s5" });
  });
});
