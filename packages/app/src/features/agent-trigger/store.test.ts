import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../lib/api";
import { getCachedTriggersForAgent, useTriggerStore } from "./store";
import { queryClient } from "../../queries/client";
import { projectQueryKeys } from "../../queries/keys";

function event(type: string, extra: Record<string, unknown>) {
  return { type, agentId: "agent-1", triggerId: "trig-1", ...extra } as never;
}

describe("useTriggerStore", () => {
  beforeEach(() => {
    useTriggerStore.setState({ byProject: {} });
    queryClient.clear();
  });

  it("marks a trigger running on trigger_triggered and bumps the event version", () => {
    useTriggerStore.getState().handleTriggerEvent("project-1", event("trigger_triggered", { triggeredAt: 1 }));

    const data = useTriggerStore.getState().byProject["project-1"];
    expect(data?.runningTriggerIdsByAgent["agent-1"]).toEqual(["trig-1"]);
    expect(data?.triggerEventVersion).toBe(1);
  });

  it("removes the running mark on trigger_completed and refreshes sessions", () => {
    useTriggerStore.getState().handleTriggerEvent("project-1", event("trigger_triggered", { triggeredAt: 1 }));
    useTriggerStore.getState().handleTriggerEvent("project-1", event("trigger_completed", { sessionId: "s1", status: "success" }));

    const data = useTriggerStore.getState().byProject["project-1"];
    expect(data?.runningTriggerIdsByAgent["agent-1"]).toEqual([]);
    expect(data?.triggerEventVersion).toBe(2);
  });

  it("removes the running mark on trigger_failed without refreshing sessions", () => {
    useTriggerStore.getState().handleTriggerEvent("project-1", event("trigger_triggered", { triggeredAt: 1 }));
    useTriggerStore.getState().handleTriggerEvent("project-1", event("trigger_failed", { error: "boom" }));

    expect(useTriggerStore.getState().byProject["project-1"]?.runningTriggerIdsByAgent["agent-1"]).toEqual([]);
  });

  it("only bumps the event version on trigger_updated", () => {
    useTriggerStore.getState().handleTriggerEvent("project-1", event("trigger_updated", {}));

    const data = useTriggerStore.getState().byProject["project-1"];
    expect(data?.runningTriggerIdsByAgent).toEqual({});
    expect(data?.triggerEventVersion).toBe(1);
  });

  it("clears project data on clearProject", () => {
    useTriggerStore.getState().handleTriggerEvent("project-1", event("trigger_triggered", { triggeredAt: 1 }));

    useTriggerStore.getState().clearProject("project-1");

    expect(useTriggerStore.getState().byProject["project-1"]).toBeUndefined();
  });

  it("runTrigger optimistically marks running and keeps the mark while the API call is in flight", async () => {
    let resolveRun!: () => void;
    const client = {
      runTrigger: vi.fn().mockReturnValue(new Promise<void>((resolve) => { resolveRun = resolve; })),
    } as unknown as ApiClient;

    const pending = useTriggerStore.getState().runTrigger("project-1", client, "agent-1", "trig-1");

    expect(useTriggerStore.getState().byProject["project-1"]?.runningTriggerIdsByAgent["agent-1"]).toEqual(["trig-1"]);
    resolveRun();
    await pending;
    expect(useTriggerStore.getState().byProject["project-1"]?.runningTriggerIdsByAgent["agent-1"]).toEqual(["trig-1"]);
  });

  it("runTrigger rolls back the running mark when the API call fails", async () => {
    const client = {
      runTrigger: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as ApiClient;

    await expect(
      useTriggerStore.getState().runTrigger("project-1", client, "agent-1", "trig-1"),
    ).rejects.toThrow("boom");

    expect(useTriggerStore.getState().byProject["project-1"]?.runningTriggerIdsByAgent["agent-1"]).toEqual([]);
  });

  it("getCachedTriggersForAgent selects from the query cache", () => {
    queryClient.setQueryData(projectQueryKeys.triggers("project-1"), {
      triggers: [
        { agentId: "agent-1", id: "t1", enabled: true },
        { agentId: "agent-2", id: "t2", enabled: true },
      ],
    });

    const selected = getCachedTriggersForAgent("project-1", "agent-1");

    expect(selected?.map((item) => item.id)).toEqual(["t1"]);
  });
});
