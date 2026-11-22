import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerManager } from "@spherse/core";
import { triggerMethods } from "@spherse/rpc/methods";
import { callMethod, createFakeProjectCtx, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";

interface ResultFrame {
  type: string;
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

let harness: RpcHarness;
let listProject: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listProject = vi.fn().mockResolvedValue([
    {
      agentId: "a1",
      entry: {
        id: "t1",
        enabled: true,
        type: "time",
        cron: "0 9 * * *",
        mode: "new_session",
        message: "hello",
        notify: false,
        createdAt: 1,
        updatedAt: 1,
      },
      nextTriggerAt: new Date("2026-08-27T01:00:00.000Z"),
    },
    {
      agentId: "a2",
      entry: {
        id: "t2",
        enabled: true,
        type: "event",
        eventName: "evt",
        mode: "new_session",
        message: "hi",
        notify: false,
        createdAt: 1,
        updatedAt: 1,
      },
      nextTriggerAt: null,
    },
  ]);
  harness = createRpcHarness({
    methods: triggerMethods,
    projectCtx: createFakeProjectCtx({
      triggerManager: { listProject } as unknown as TriggerManager,
    }),
  });
});

describe("triggers.listProject", () => {
  it("returns the merged project trigger list with agentId and nextTriggerAt", async () => {
    const frame = (await callMethod(harness, "triggers.listProject", { projectId: "p1" })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({
      ok: true,
      triggers: [
        {
          agentId: "a1",
          id: "t1",
          enabled: true,
          type: "time",
          cron: "0 9 * * *",
          mode: "new_session",
          message: "hello",
          notify: false,
          createdAt: 1,
          updatedAt: 1,
          nextTriggerAt: Date.parse("2026-08-27T01:00:00.000Z"),
        },
        {
          agentId: "a2",
          id: "t2",
          enabled: true,
          type: "event",
          eventName: "evt",
          mode: "new_session",
          message: "hi",
          notify: false,
          createdAt: 1,
          updatedAt: 1,
          nextTriggerAt: null,
        },
      ],
    });
    expect(listProject).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list for projects without triggers", async () => {
    listProject.mockResolvedValue([]);
    const frame = (await callMethod(harness, "triggers.listProject", { projectId: "p1" })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ ok: true, triggers: [] });
  });
});
