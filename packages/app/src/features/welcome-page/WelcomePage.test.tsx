import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWelcomePage } from "../../queries/welcome-page";
import { connectMockBus, emitBusEvent, stubMockBusSocket, teardownMockBus } from "../../test/bus";
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stubMockBusSocket();
  vi.mocked(useWelcomePage).mockReturnValue({
    data: { path: "welcome/index.html" },
    isError: false,
  } as never);
});

afterEach(() => {
  teardownMockBus();
  vi.useRealTimers();
});

function emitFsWatch(path: string) {
  emitBusEvent({
    channel: "fs-watch",
    projectId: "p1",
    type: "change",
    payload: { eventType: "change", path },
  });
}

describe("WelcomePage reload", () => {
  it("debounces rapid save bursts into a single forced reload via the React key", async () => {
    const view = renderWithProviders(<WelcomePage fallback={<div>fallback</div>} />);
    await connectMockBus();

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
    await connectMockBus();

    const imgBefore = screen.getByAltText("Welcome Page");
    emitFsWatch("welcome\\poster.png");
    act(() => vi.advanceTimersByTime(300));

    const imgAfter = screen.getByAltText("Welcome Page");
    expect(imgAfter).not.toBe(imgBefore);
    view.unmount();
  });

  it("clears the debounce timer on unmount", async () => {
    const { unmount } = renderWithProviders(<WelcomePage fallback={<div>fallback</div>} />);
    await connectMockBus();
    const before = vi.getTimerCount();

    emitFsWatch("welcome/index.html");
    expect(vi.getTimerCount()).toBe(before + 1);

    unmount();
    expect(vi.getTimerCount()).toBe(before);
  });
});
