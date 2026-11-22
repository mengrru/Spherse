import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionMethods } from "@spherse/rpc/methods";
import { callMethod, createFakeProjectCtx, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";

function createHarness(): RpcHarness {
  return createRpcHarness({
    methods: sessionMethods,
    projectCtx: createFakeProjectCtx({
      sessionRuntime: { createSession: vi.fn().mockResolvedValue("session-new") },
    }),
  });
}

let harness: RpcHarness;

beforeEach(() => {
  harness = createHarness();
});

describe("sessions.create", () => {
  it("creates a session without a title and responds with sessionId", async () => {
    const frame = await callMethod(harness, "sessions.create", { projectId: "p1", agentId: "a1" });
    expect(frame).toMatchObject({ type: "result", ok: true, data: { sessionId: "session-new" } });
    expect(harness.known.sessionRuntime.createSession).toHaveBeenCalledWith("a1", undefined, undefined);
  });

  it("passes the request title through to sessionRuntime.createSession", async () => {
    const frame = await callMethod(harness, "sessions.create", {
      projectId: "p1",
      agentId: "a1",
      title: "Trip Plan",
    });
    expect(frame).toMatchObject({ type: "result", ok: true, data: { sessionId: "session-new" } });
    expect(harness.known.sessionRuntime.createSession).toHaveBeenCalledWith("a1", undefined, "Trip Plan");
  });

  it("rejects an empty title with invalid params", async () => {
    const frame = await callMethod(harness, "sessions.create", { projectId: "p1", agentId: "a1", title: "" });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.known.sessionRuntime.createSession).not.toHaveBeenCalled();
  });

  it("rejects a non-string title with invalid params", async () => {
    const frame = await callMethod(harness, "sessions.create", {
      projectId: "p1",
      agentId: "a1",
      title: { nope: true },
    });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.known.sessionRuntime.createSession).not.toHaveBeenCalled();
  });
});
