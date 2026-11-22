import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionMethods } from "@spherse/rpc/methods";
import { callMethod, createFakeProjectCtx, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";

function session(id: string, agentId: string, updatedAt: number) {
  return { id, agentId, createdAt: updatedAt - 1, updatedAt, status: "active" as const };
}

const sessions = [session("s2", "a2", 20), session("s1", "a1", 10)];
const byAgent = {
  a1: { hasMore: false, loaded: 1 },
  a2: { hasMore: true, loaded: 1 },
};

function createHarness(): RpcHarness {
  return createRpcHarness({
    methods: sessionMethods,
    projectCtx: createFakeProjectCtx({
      projectManager: {
        listProjectSessions: vi.fn(() => ({ sessions, byAgent })),
      },
    }),
  });
}

let harness: RpcHarness;

beforeEach(() => {
  harness = createHarness();
});

describe("sessions.listProject", () => {
  it("returns the merged catalog with byAgent cursors", async () => {
    const frame = await callMethod(harness, "sessions.listProject", { projectId: "p1" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ ok: true, sessions, byAgent });
    expect(harness.known.projectManager.listProjectSessions).toHaveBeenCalledWith(10);
  });

  it("passes perPage through to the manager", async () => {
    const frame = await callMethod(harness, "sessions.listProject", { projectId: "p1", perPage: 25 });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(harness.known.projectManager.listProjectSessions).toHaveBeenLastCalledWith(25);
  });

  it("accepts perPage at both bounds", async () => {
    await callMethod(harness, "sessions.listProject", { projectId: "p1", perPage: 1 });
    expect(harness.known.projectManager.listProjectSessions).toHaveBeenLastCalledWith(1);

    await callMethod(harness, "sessions.listProject", { projectId: "p1", perPage: 100 });
    expect(harness.known.projectManager.listProjectSessions).toHaveBeenLastCalledWith(100);
  });

  it("rejects a perPage below 1 with invalid params instead of clamping", async () => {
    const frame = await callMethod(harness, "sessions.listProject", { projectId: "p1", perPage: 0 });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.known.projectManager.listProjectSessions).not.toHaveBeenCalled();
  });

  it("rejects a perPage above 100 with invalid params instead of clamping", async () => {
    const frame = await callMethod(harness, "sessions.listProject", { projectId: "p1", perPage: 500 });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.known.projectManager.listProjectSessions).not.toHaveBeenCalled();
  });

  it("rejects a non-integer perPage with invalid params instead of falling back to the default", async () => {
    const frame = await callMethod(harness, "sessions.listProject", { projectId: "p1", perPage: "25" });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.known.projectManager.listProjectSessions).not.toHaveBeenCalled();
  });
});
