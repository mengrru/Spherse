import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWelcomePage } from "../../queries/welcome-page";
import { useBusStore } from "../../stores/bus-store";
import { renderWithProviders } from "../../test/render";
import { WelcomePage } from "./index";

vi.mock("../../queries/welcome-page", () => ({
  useWelcomePage: vi.fn(),
}));

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

const OPEN = 1;

interface MockSocket {
  readyState: number;
  onopen: ((ev: Event) => void | null);
  onmessage: ((ev: MessageEvent) => void | null);
  onclose: ((ev: CloseEvent) => void | null);
  onerror: ((ev: Event) => void | null);
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  useBusStore.setState({ status: "idle", resumedAt: null });
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.mocked(useWelcomePage).mockReturnValue({
    data: { path: "welcome/index.html" },
    isError: false,
  } as never);
});

afterEach(() => {
  useBusStore.getState().teardown();
  useBusStore.setState({ status: "idle", resumedAt: null });
  socket = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function connectBus() {
  await useBusStore.getState().init({
    kind: "electron",
    capabilities: {},
    getServerBaseUrl: async () => "http://localhost:5173",
    getSettings: async () => null,
    saveSettings: async () => ({ success: true }),
    openExternal: async () => {},
  } as never);
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

describe("WelcomePage reload", () => {
  it("debounces rapid save bursts into a single forced reload via the React key", async () => {
    const view = renderWithProviders(<WelcomePage fallback={<div>fallback</div>} />);
    await connectBus();

    const iframeBefore = screen.getByTitle("Welcome Page");
    emitFsWatch("welcome/index.html");
    emitFsWatch("welcome/index.html");
    act(() => vi.advanceTimersByTime(200));
    emitFsWatch("welcome/index.html");
    act(() => vi.advanceTimersByTime(299));
    expect(screen.getByTitle("Welcome Page")).toBe(iframeBefore);

    act(() => vi.advanceTimersByTime(1));

    const iframeAfter = screen.getByTitle("Welcome Page");
    expect(iframeAfter).not.toBe(iframeBefore);
    expect(iframeBefore.isConnected).toBe(false);
    expect(iframeAfter).toHaveAttribute("src", "http://localhost:5173/api/projects/p1/preview/welcome/index.html");
    view.unmount();
  });

  it("debounces the same way for image welcome pages", async () => {
    vi.mocked(useWelcomePage).mockReturnValue({
      data: { path: "welcome/poster.png" },
      isError: false,
    } as never);
    const view = renderWithProviders(<WelcomePage fallback={<div>fallback</div>} />);
    await connectBus();

    const imgBefore = screen.getByAltText("Welcome Page");
    emitFsWatch("welcome\\poster.png");
    act(() => vi.advanceTimersByTime(300));

    const imgAfter = screen.getByAltText("Welcome Page");
    expect(imgAfter).not.toBe(imgBefore);
    view.unmount();
  });

  it("clears the debounce timer on unmount", async () => {
    const { unmount } = renderWithProviders(<WelcomePage fallback={<div>fallback</div>} />);
    await connectBus();
    const before = vi.getTimerCount();

    emitFsWatch("welcome/index.html");
    expect(vi.getTimerCount()).toBe(before + 1);

    unmount();
    expect(vi.getTimerCount()).toBe(before);
  });
});
