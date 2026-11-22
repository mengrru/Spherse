import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSearchHit } from "@spherse/contracts";
import { sessionMethods } from "@spherse/rpc/methods";
import { callMethod, createFakeProjectCtx, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";

function hit(overrides: Partial<SessionSearchHit> = {}): SessionSearchHit {
  return {
    agentId: "a1",
    sessionId: "s1",
    sessionTitle: "session",
    seq: 3,
    role: "user",
    snippet: "…needle…",
    time: 100,
    ...overrides,
  };
}

function createHarness(): RpcHarness {
  return createRpcHarness({
    methods: sessionMethods,
    projectCtx: createFakeProjectCtx({
      projectManager: {
        searchProjectMessages: vi.fn(() => [hit()]),
      },
    }),
  });
}

let harness: RpcHarness;

beforeEach(() => {
  harness = createHarness();
});

describe("sessions.search", () => {
  it("passes q and the default limit to the manager", async () => {
    const frame = await callMethod(harness, "sessions.search", { projectId: "p1", q: "needle" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ results: [hit()] });
    expect(harness.known.projectManager.searchProjectMessages).toHaveBeenCalledWith("needle", 50);
  });

  it("passes a trimmed q through to the manager", async () => {
    const frame = await callMethod(harness, "sessions.search", { projectId: "p1", q: "  needle  " });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(harness.known.projectManager.searchProjectMessages).toHaveBeenCalledWith("needle", 50);
  });

  it("returns empty results without calling the manager for blank q", async () => {
    const frame = await callMethod(harness, "sessions.search", { projectId: "p1", q: "  " });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ results: [] });
    expect(harness.known.projectManager.searchProjectMessages).not.toHaveBeenCalled();
  });

  it("accepts limit at both bounds", async () => {
    await callMethod(harness, "sessions.search", { projectId: "p1", q: "a", limit: 1 });
    expect(harness.known.projectManager.searchProjectMessages).toHaveBeenLastCalledWith("a", 1);

    await callMethod(harness, "sessions.search", { projectId: "p1", q: "a", limit: 100 });
    expect(harness.known.projectManager.searchProjectMessages).toHaveBeenLastCalledWith("a", 100);
  });

  it("rejects a limit above 100 with invalid params instead of clamping", async () => {
    const frame = await callMethod(harness, "sessions.search", { projectId: "p1", q: "a", limit: 500 });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.known.projectManager.searchProjectMessages).not.toHaveBeenCalled();
  });

  it("rejects a limit below 1 with invalid params instead of clamping", async () => {
    const frame = await callMethod(harness, "sessions.search", { projectId: "p1", q: "a", limit: 0 });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.known.projectManager.searchProjectMessages).not.toHaveBeenCalled();
  });

  it("rejects a non-integer limit with invalid params instead of falling back to the default", async () => {
    const frame = await callMethod(harness, "sessions.search", { projectId: "p1", q: "a", limit: "50" });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.known.projectManager.searchProjectMessages).not.toHaveBeenCalled();
  });

  it("omits hits without a session title so the contract parses", async () => {
    (
      harness.known.projectManager.searchProjectMessages as ReturnType<typeof vi.fn>
    ).mockReturnValue([hit({ sessionTitle: undefined, snippet: "needle" })]);
    const frame = await callMethod(harness, "sessions.search", { projectId: "p1", q: "needle" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({
      results: [{ agentId: "a1", sessionId: "s1", seq: 3, role: "user", snippet: "needle", time: 100 }],
    });
  });
});
