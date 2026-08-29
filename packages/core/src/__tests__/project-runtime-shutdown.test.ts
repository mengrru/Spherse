import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRuntime } from "../project-runtime.js";
import { createSilentLogger } from "../logger.js";
import type { Capability } from "../kernel/capability.js";
import type { ProjectManager } from "../project-manager.js";
import type { SessionManager } from "../session/session-manager.js";

type FakeCapability = Partial<Capability> & { id: string };

function makeRuntime(capabilities: FakeCapability[]) {
  const projectManager = { close: vi.fn() };
  const sessionRuntime = { closeAll: vi.fn(async () => {}) };
  const runtime = new ProjectRuntime({
    projectManager: projectManager as unknown as ProjectManager,
    sessionRuntime: sessionRuntime as unknown as SessionManager,
    projectId: "p1",
    logger: createSilentLogger(),
    capabilities: capabilities as unknown as ReadonlyArray<Capability>,
  });
  return { runtime, projectManager };
}

describe("ProjectRuntime.shutdown stage isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out a hanging capability shutdown and still runs the rest", async () => {
    const order: string[] = [];
    const { runtime, projectManager } = makeRuntime([
      { id: "hang", shutdown: () => new Promise<void>(() => {}) },
      { id: "next", shutdown: async () => { order.push("next"); } },
    ]);
    let resolved = false;
    void runtime.shutdown().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    expect(order).toEqual(["next"]);
    expect(projectManager.close).toHaveBeenCalledTimes(1);
  });

  it("continues past a capability shutdown that rejects", async () => {
    const order: string[] = [];
    const { runtime, projectManager } = makeRuntime([
      { id: "bad", shutdown: async () => { throw new Error("boom"); } },
      { id: "next", shutdown: async () => { order.push("next"); } },
    ]);
    await runtime.shutdown();
    expect(order).toEqual(["next"]);
    expect(projectManager.close).toHaveBeenCalledTimes(1);
  });

  it("runs all capability shutdowns and closes the project manager on the happy path", async () => {
    const first = vi.fn(async () => {});
    const { runtime, projectManager } = makeRuntime([
      { id: "a", shutdown: first },
      { id: "b" },
    ]);
    await runtime.shutdown();
    expect(first).toHaveBeenCalledTimes(1);
    expect(projectManager.close).toHaveBeenCalledTimes(1);
    await runtime.shutdown();
    expect(projectManager.close).toHaveBeenCalledTimes(1);
  });
});
