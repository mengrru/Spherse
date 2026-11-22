import { beforeEach, describe, expect, it, vi } from "vitest";
import { debugMethods } from "@spherse/rpc/methods";
import { callMethod, createFakeProjectCtx, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";

interface ResultFrame {
  type: string;
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function turnContextSnapshot() {
  return {
    sessionId: "s1",
    capturedAt: "2024-01-01T00:00:00.000Z",
    systemPrompt: "p",
    messages: [],
    tools: [],
    compaction: null,
    compactionCount: 0,
  };
}

function createHarness(): RpcHarness {
  return createRpcHarness({
    methods: debugMethods,
    projectCtx: createFakeProjectCtx({
      sessionRuntime: {
        getTurnContext: vi.fn(() => turnContextSnapshot()),
        readSessionEventsAfter: vi.fn(() => [
          { seq: 0, type: "user/message", time: 1, data: { message: { role: "user" } } },
          { seq: 1, type: "turn/start", time: 1, data: {} },
        ]),
      },
    }),
  });
}

let harness: RpcHarness;

beforeEach(() => {
  harness = createHarness();
});

describe("debug.sessionEvents", () => {
  it("returns the full event log for the session", async () => {
    const frame = (await callMethod(harness, "debug.sessionEvents", {
      projectId: "p1",
      agentId: "a1",
      sessionId: "s1",
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({
      sessionId: "s1",
      events: [
        { seq: 0, type: "user/message", time: 1, data: { message: { role: "user" } } },
        { seq: 1, type: "turn/start", time: 1, data: {} },
      ],
    });
    expect(harness.known.sessionRuntime.readSessionEventsAfter).toHaveBeenCalledWith(
      "a1",
      "s1",
      -1,
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects a missing agentId with invalid params", async () => {
    const frame = (await callMethod(harness, "debug.sessionEvents", {
      projectId: "p1",
      sessionId: "s1",
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.known.sessionRuntime.readSessionEventsAfter).not.toHaveBeenCalled();
  });

  it("passes compaction/applied events through unchanged", async () => {
    (harness.known.sessionRuntime.readSessionEventsAfter as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        seq: 12,
        type: "compaction/applied",
        time: 1700000000000,
        data: { anchorSeq: 8, digestContent: "d", excludedSeqs: [9, 10, 11], digestSource: "llm" },
      },
    ]);
    const frame = (await callMethod(harness, "debug.sessionEvents", {
      projectId: "p1",
      agentId: "a1",
      sessionId: "s1",
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({
      sessionId: "s1",
      events: [
        {
          seq: 12,
          type: "compaction/applied",
          time: 1700000000000,
          data: { anchorSeq: 8, digestContent: "d", excludedSeqs: [9, 10, 11], digestSource: "llm" },
        },
      ],
    });
  });
});

describe("debug.turnContext", () => {
  it("returns the turn context snapshot with compaction metadata", async () => {
    (harness.known.sessionRuntime.getTurnContext as ReturnType<typeof vi.fn>).mockReturnValue({
      ...turnContextSnapshot(),
      compaction: {
        seq: 12,
        anchorSeq: 8,
        digestSource: "llm",
        excludedCount: 3,
        digestLength: 2048,
        appliedAtMs: 1700000000000,
      },
      compactionCount: 1,
    });
    const frame = (await callMethod(harness, "debug.turnContext", {
      projectId: "p1",
      sessionId: "s1",
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toMatchObject({
      compaction: { seq: 12, anchorSeq: 8, digestSource: "llm", excludedCount: 3, digestLength: 2048 },
      compactionCount: 1,
    });
  });

  it("fails with an internal error when the snapshot misses required compaction fields", async () => {
    (harness.known.sessionRuntime.getTurnContext as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionId: "s1",
      capturedAt: "2024-01-01T00:00:00.000Z",
      systemPrompt: "p",
      messages: [],
      tools: [],
    });
    const frame = (await callMethod(harness, "debug.turnContext", {
      projectId: "p1",
      sessionId: "s1",
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32603 } });
    expect(frame.error?.message).toContain("Invalid payload");
  });
});
