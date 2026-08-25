import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerEventBridge } from "./TriggerEventBridge";
import { useTriggerStore } from "./store";
import { ProjectProvider } from "../../context/project-context";
import { useBusStore } from "../../stores/bus-store";
import { queryClient as globalQueryClient } from "../../queries/client";
import { projectQueryKeys } from "../../queries/keys";

const OPEN = 1;

interface MockSocket {
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  sent: string[];
  close: () => void;
}

let socket: MockSocket | null = null;

class MockWebSocket {
  static OPEN = OPEN;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sent: string[] = [];
  constructor() {
    socket = this as unknown as MockSocket;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

function createBridge() {
  return {
    kind: "electron" as const,
    capabilities: {},
    getServerBaseUrl: async () => "http://localhost:5173",
    getSettings: async () => null,
    saveSettings: async () => ({ success: true }),
    openExternal: async () => {},
  };
}

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  useBusStore.setState({ status: "idle", resumedAt: null });
  useTriggerStore.setState({ byProject: {} });
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  useBusStore.getState().teardown();
  useBusStore.setState({ status: "idle", resumedAt: null });
  host.remove();
  socket = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderBridge() {
  const Probe = () => (
    <MemoryRouter>
      <ProjectProvider projectId="p1" projectRoot="/tmp/p1">
        <TriggerEventBridge />
      </ProjectProvider>
    </MemoryRouter>
  );
  act(() => {
    root = createRoot(host);
    root.render(<Probe />);
  });
}

async function connectBus() {
  await useBusStore.getState().init(createBridge() as never);
  if (!socket) throw new Error("socket not created");
  socket.readyState = OPEN;
  act(() => {
    socket!.onopen?.({} as Event);
  });
}

function emitTrigger(type: string, payload: object) {
  socket!.onmessage?.({ data: JSON.stringify({
    channel: "trigger",
    projectId: "p1",
    type,
    payload,
  }) } as MessageEvent);
}

function bumpResumedAt() {
  act(() => {
    useBusStore.setState({ resumedAt: (useBusStore.getState().resumedAt ?? 0) + 1 });
  });
}

describe("TriggerEventBridge", () => {
  it("marks a trigger running on trigger_triggered without invalidating the query cache", async () => {
    renderBridge();
    await connectBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitTrigger("trigger_triggered", { agentId: "a1", triggerId: "t1", triggeredAt: 1 });

    expect(useTriggerStore.getState().byProject["p1"]?.runningTriggerIdsByAgent["a1"]).toEqual(["t1"]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates the triggers cache on trigger_updated", async () => {
    renderBridge();
    await connectBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitTrigger("trigger_updated", { agentId: "a1", triggerId: "t1" });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.triggers("p1") });
  });

  it("removes the running mark, invalidates, and shows a notification on trigger_completed", async () => {
    renderBridge();
    await connectBus();
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
    await connectBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitTrigger("trigger_triggered", { agentId: "a1", triggerId: "t1", triggeredAt: 1 });
    emitTrigger("trigger_failed", { agentId: "a1", triggerId: "t1", error: "boom" });

    expect(useTriggerStore.getState().byProject["p1"]?.runningTriggerIdsByAgent["a1"]).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.triggers("p1") });
  });

  it("invalidates and clears stale running marks after a bus reconnect", async () => {
    renderBridge();
    await connectBus();
    emitTrigger("trigger_triggered", { agentId: "a1", triggerId: "t1", triggeredAt: 1 });
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");

    bumpResumedAt();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.triggers("p1") });
    expect(useTriggerStore.getState().byProject["p1"]?.runningTriggerIdsByAgent).toEqual({});
  });
});
