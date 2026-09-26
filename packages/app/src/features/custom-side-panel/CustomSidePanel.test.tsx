import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectMockBus, emitBusEvent, stubMockBusSocket, teardownMockBus } from "../../test/bus";
import { renderWithProviders } from "../../test/render";
import { useCustomSidePanelStore } from "../../stores/custom-side-panel-store";
import { CustomSidePanel } from "./index";

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stubMockBusSocket();
  useCustomSidePanelStore.setState({ activeByProject: {} });
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

describe("CustomSidePanel", () => {
  it("renders a transparent borderless iframe pointing at the preview route", async () => {
    const view = renderWithProviders(<CustomSidePanel path="panel/index.html" />);
    await connectMockBus();

    const iframe = screen.getByTitle("侧边面板");
    expect(iframe).toHaveAttribute(
      "src",
      "http://localhost:5173/api/projects/p1/preview/panel/index.html",
    );
    expect(iframe.className).not.toContain("bg-");
    view.unmount();
  });

  it("debounces rapid save bursts into a single forced reload via the React key", async () => {
    const view = renderWithProviders(<CustomSidePanel path="panel/index.html" />);
    await connectMockBus();

    const iframeBefore = screen.getByTitle("侧边面板");
    emitFsWatch("panel/index.html");
    emitFsWatch("panel/index.html");
    act(() => vi.advanceTimersByTime(200));
    emitFsWatch("panel/index.html");
    act(() => vi.advanceTimersByTime(299));
    expect(screen.getByTitle("侧边面板")).toBe(iframeBefore);

    act(() => vi.advanceTimersByTime(1));

    const iframeAfter = screen.getByTitle("侧边面板");
    expect(iframeAfter).not.toBe(iframeBefore);
    expect(iframeBefore.isConnected).toBe(false);
    view.unmount();
  });

  it("ignores fs-watch events for other paths", async () => {
    const view = renderWithProviders(<CustomSidePanel path="panel/index.html" />);
    await connectMockBus();

    const iframeBefore = screen.getByTitle("侧边面板");
    emitFsWatch("other/file.html");
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByTitle("侧边面板")).toBe(iframeBefore);
    view.unmount();
  });

  it("clears the debounce timer on unmount", async () => {
    const { unmount } = renderWithProviders(<CustomSidePanel path="panel/index.html" />);
    await connectMockBus();
    const before = vi.getTimerCount();

    emitFsWatch("panel/index.html");
    expect(vi.getTimerCount()).toBe(before + 1);

    unmount();
    expect(vi.getTimerCount()).toBe(before);
  });

  it("deactivates the view via the corner exit button", async () => {
    useCustomSidePanelStore.getState().setActive("p1", true);
    const view = renderWithProviders(<CustomSidePanel path="panel/index.html" />);
    await connectMockBus();

    act(() => {
      screen.getByRole("button", { name: "显示默认面板" }).click();
    });
    expect(useCustomSidePanelStore.getState().isActive("p1")).toBe(false);
    view.unmount();
  });
});
