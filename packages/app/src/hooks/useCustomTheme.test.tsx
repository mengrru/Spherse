import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomTheme } from "./useCustomTheme";
import { useBusStore } from "../stores/bus-store";

let host: HTMLDivElement;
let root: Root | null = null;

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

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  document.getElementById("custom-theme-link")?.remove();
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
  vi.unstubAllGlobals();
});

function renderHook(props: Parameters<typeof useCustomTheme>) {
  const Probe = () => {
    useCustomTheme(...props);
    return null;
  };
  act(() => {
    root = createRoot(host);
    root.render(<Probe />);
  });
}

function currentLink(): HTMLLinkElement | null {
  return document.getElementById("custom-theme-link") as HTMLLinkElement | null;
}

async function connectBus() {
  await useBusStore.getState().init(createBridge() as never);
  if (!socket) throw new Error("socket not created");
  socket.readyState = OPEN;
  act(() => {
    socket!.onopen?.({} as Event);
  });
}

describe("useCustomTheme", () => {
  it("mounts a theme stylesheet link for the active project", () => {
    renderHook(["/tmp/p1", "http://localhost:5173", "p1", null]);
    const link = currentLink();
    expect(link).not.toBeNull();
    expect(link?.rel).toBe("stylesheet");
    expect(link?.href).toContain("/api/projects/p1/preview/.spherse/theme.css");
  });

  it("no-ops without project context", () => {
    renderHook([undefined, "http://localhost:5173", "p1", null]);
    expect(currentLink()).toBeNull();
  });

  it("replaces the link when fs-watch reports theme.css changed", async () => {
    renderHook(["/tmp/p1", "http://localhost:5173", "p1", null]);
    await connectBus();
    const firstLink = currentLink();
    expect(firstLink).toBeTruthy();

    socket!.onmessage?.({ data: JSON.stringify({
      channel: "fs-watch",
      projectId: "p1",
      type: "change",
      payload: { eventType: "change", path: ".spherse/theme.css" },
    }) } as MessageEvent);

    const secondLink = currentLink();
    expect(secondLink).toBeTruthy();
    expect(secondLink).not.toBe(firstLink);
    expect(secondLink?.href).toContain("/api/projects/p1/preview/.spherse/theme.css");
  });

  it("ignores fs-watch events for other paths", async () => {
    renderHook(["/tmp/p1", "http://localhost:5173", "p1", null]);
    await connectBus();
    const firstLink = currentLink();

    socket!.onmessage?.({ data: JSON.stringify({
      channel: "fs-watch",
      projectId: "p1",
      type: "change",
      payload: { eventType: "change", path: "README.md" },
    }) } as MessageEvent);

    expect(currentLink()).toBe(firstLink);
  });

  it("remounts the link after a reconnect (resume compensation)", async () => {
    renderHook(["/tmp/p1", "http://localhost:5173", "p1", null]);
    await connectBus();
    const firstLink = currentLink();
    expect(firstLink).toBeTruthy();

    act(() => {
      // Strictly greater than the value set by onopen so the subscription
      // fires deterministically (Date.now() may repeat within the same ms).
      useBusStore.setState({ resumedAt: (useBusStore.getState().resumedAt ?? 0) + 1 });
    });

    const secondLink = currentLink();
    expect(secondLink).toBeTruthy();
    expect(secondLink).not.toBe(firstLink);
    expect(secondLink?.href).toContain("/api/projects/p1/preview/.spherse/theme.css");
  });
});
