import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomePageQueryBridge } from "./WelcomePageQueryBridge";
import { ProjectProvider } from "../../context/project-context";
import { useBusStore } from "../../stores/bus-store";
import { queryClient as globalQueryClient } from "../../queries/client";
import { projectQueryKeys } from "../../queries/keys";
import { WELCOME_PAGE_CONFIG_PATH } from "../../queries/welcome-page";

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
    <ProjectProvider projectId="p1" projectRoot="/tmp/p1">
      <WelcomePageQueryBridge />
    </ProjectProvider>
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

function emitFsWatch(path: string) {
  socket!.onmessage?.({ data: JSON.stringify({
    channel: "fs-watch",
    projectId: "p1",
    type: "change",
    payload: { eventType: "change", path },
  }) } as MessageEvent);
}

describe("WelcomePageQueryBridge", () => {
  it("invalidates the welcome-page cache when fs-watch reports project.yaml changed", async () => {
    renderBridge();
    await connectBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitFsWatch(WELCOME_PAGE_CONFIG_PATH);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.welcomePage("p1") });
  });

  it("ignores fs-watch events for other paths", async () => {
    renderBridge();
    await connectBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitFsWatch("index.html");

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates after a bus reconnect", async () => {
    renderBridge();
    await connectBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");

    act(() => {
      useBusStore.setState({ resumedAt: (useBusStore.getState().resumedAt ?? 0) + 1 });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.welcomePage("p1") });
  });
});
