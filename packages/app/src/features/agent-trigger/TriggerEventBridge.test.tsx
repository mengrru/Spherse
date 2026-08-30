import { vi } from "vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TriggerEventBridge } from "./TriggerEventBridge";
import { useTriggerStore } from "./store";
import { bumpBusResumedAt, connectMockBus, emitBusEvent, stubMockBusSocket, teardownMockBus } from "../../test/bus";
import { renderWithProviders } from "../../test/render";
import { queryClient as globalQueryClient } from "../../queries/client";
import { projectQueryKeys } from "../../queries/keys";

beforeEach(() => {
  useTriggerStore.setState({ byProject: {} });
  stubMockBusSocket();
});

afterEach(() => {
  teardownMockBus();
  vi.restoreAllMocks();
});

function renderBridge() {
  renderWithProviders(<TriggerEventBridge />);
}

function emitTrigger(type: string, payload: object) {
  emitBusEvent({ channel: "trigger", projectId: "p1", type, payload });
}

describe("TriggerEventBridge", () => {
  it("marks a trigger running on trigger_triggered without invalidating the query cache", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitTrigger("trigger_triggered", { agentId: "a1", triggerId: "t1", triggeredAt: 1 });

    expect(useTriggerStore.getState().byProject["p1"]?.runningTriggerIdsByAgent["a1"]).toEqual(["t1"]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates the triggers cache on trigger_updated", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitTrigger("trigger_updated", { agentId: "a1", triggerId: "t1" });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.triggers("p1") });
  });

  it("removes the running mark, invalidates, and shows a notification on trigger_completed", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    const toastMock = await import("sonner").then((m) => vi.spyOn(m.toast, "success"));
    globalQueryClient.setQueryData(projectQueryKeys.triggers("p1"), {
      triggers: [
        {
          agentId: "a1",
          id: "t1",
          enabled: true,
          notify: true,
          notificationMessage: "done!",
          type: "time",
          mode: "new_session",
          message: "m",
          createdAt: 1,
          updatedAt: 1,
          nextTriggerAt: null,
        },
      ],
    });
    emitTrigger("trigger_triggered", { agentId: "a1", triggerId: "t1", triggeredAt: 1 });
    emitTrigger("trigger_completed", { agentId: "a1", triggerId: "t1", sessionId: "s1", status: "success" });

    expect(useTriggerStore.getState().byProject["p1"]?.runningTriggerIdsByAgent["a1"]).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.triggers("p1") });
    expect(toastMock).toHaveBeenCalledWith(
      "done!",
      expect.objectContaining({ action: expect.objectContaining({ label: expect.any(String) }) }),
    );
  });

  it("clears the running mark and invalidates on trigger_failed", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitTrigger("trigger_triggered", { agentId: "a1", triggerId: "t1", triggeredAt: 1 });
    emitTrigger("trigger_failed", { agentId: "a1", triggerId: "t1", error: "boom" });

    expect(useTriggerStore.getState().byProject["p1"]?.runningTriggerIdsByAgent["a1"]).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.triggers("p1") });
  });

  it("invalidates and clears stale running marks after a bus reconnect", async () => {
    renderBridge();
    await connectMockBus();
    emitTrigger("trigger_triggered", { agentId: "a1", triggerId: "t1", triggeredAt: 1 });
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");

    bumpBusResumedAt();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.triggers("p1") });
    expect(useTriggerStore.getState().byProject["p1"]?.runningTriggerIdsByAgent).toEqual({});
  });
});
