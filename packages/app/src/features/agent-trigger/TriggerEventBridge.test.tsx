import { vi } from "vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TriggerEventBridge } from "./TriggerEventBridge";
import { useTriggerStore } from "./store";
import { useSettingsStore } from "../../stores/settings-store";
import type { HostBridge } from "../../lib/host-bridge";
import { bumpBusResumedAt, connectMockBus, emitBusEvent, stubMockBusSocket, teardownMockBus } from "../../test/bus";
import { renderWithProviders } from "../../test/render";
import { queryClient as globalQueryClient } from "../../queries/client";
import { projectQueryKeys } from "../../queries/keys";

beforeEach(() => {
  useTriggerStore.setState({ byProject: {} });
  stubMockBusSocket();
  useSettingsStore.setState({ systemNotifications: true });
  document.hasFocus = vi.fn(() => false);
});

afterEach(() => {
  teardownMockBus();
  vi.restoreAllMocks();
});

function createBridgeWithNotifications(show: (request: { title: string; body: string }) => void): HostBridge {
  return {
    kind: "electron",
    capabilities: {
      filePicker: true,
      mobileAccess: false,
      openFileExternal: false,
      tray: true,
      systemNotifications: true,
      content: { editable: true },
    },
    getServerBaseUrl: async () => "http://localhost:1",
    getSettings: async () => ({}),
    saveSettings: async () => ({ success: true }),
    openExternal: async () => {},
    notifications: { show },
  };
}

const PLAIN_BRIDGE: HostBridge = {
  ...createBridgeWithNotifications(vi.fn()),
  notifications: undefined,
};

function renderBridge(bridge?: HostBridge) {
  renderWithProviders(<TriggerEventBridge />, { bridge: bridge ?? PLAIN_BRIDGE, projectId: "p1" });
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

  it("shows a system notification on trigger_completed when unfocused", async () => {
    const show = vi.fn<(request: { title: string; body: string }) => void>();
    renderBridge(createBridgeWithNotifications(show));
    await connectMockBus();
    globalQueryClient.setQueryData(projectQueryKeys.triggers("p1"), {
      triggers: [
        {
          agentId: "a1",
          id: "t1",
          enabled: true,
          notify: true,
          name: "Daily",
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
    emitTrigger("trigger_completed", { agentId: "a1", triggerId: "t1", sessionId: "s1", status: "success" });

    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("Daily") }),
      );
    });
  });

  it("shows an error toast and system notification on trigger_failed with notify", async () => {
    const show = vi.fn<(request: { title: string; body: string }) => void>();
    const toastError = await import("sonner").then((m) => vi.spyOn(m.toast, "error"));
    renderBridge(createBridgeWithNotifications(show));
    await connectMockBus();
    globalQueryClient.setQueryData(projectQueryKeys.triggers("p1"), {
      triggers: [
        {
          agentId: "a1",
          id: "t1",
          enabled: true,
          notify: true,
          name: "Daily",
          type: "time",
          mode: "new_session",
          message: "m",
          createdAt: 1,
          updatedAt: 1,
          nextTriggerAt: null,
        },
      ],
    });
    emitTrigger("trigger_failed", { agentId: "a1", triggerId: "t1", sessionId: "s1", error: "boom" });

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalled();
      expect(show).toHaveBeenCalledTimes(1);
    });
  });

  it("does not show a system notification when the setting is off", async () => {
    useSettingsStore.setState({ systemNotifications: false });
    const show = vi.fn<(request: { title: string; body: string }) => void>();
    renderBridge(createBridgeWithNotifications(show));
    await connectMockBus();
    globalQueryClient.setQueryData(projectQueryKeys.triggers("p1"), {
      triggers: [
        {
          agentId: "a1",
          id: "t1",
          enabled: true,
          notify: true,
          name: "Daily",
          type: "time",
          mode: "new_session",
          message: "m",
          createdAt: 1,
          updatedAt: 1,
          nextTriggerAt: null,
        },
      ],
    });
    emitTrigger("trigger_failed", { agentId: "a1", triggerId: "t1", sessionId: "s1", error: "boom" });

    await vi.waitFor(() => {
      expect(show).not.toHaveBeenCalled();
    });
  });
});
