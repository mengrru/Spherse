import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomSidePanel } from "../../queries/custom-side-panel";
import { connectMockBus, emitBusEvent, stubMockBusSocket, teardownMockBus } from "../../test/bus";
import { renderWithProviders } from "../../test/render";
import { useCustomSidePanelStore } from "../../stores/custom-side-panel-store";
import { CustomSidePanel } from "./index";

vi.mock("../../queries/custom-side-panel", () => ({
  useCustomSidePanel: vi.fn(),
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
  useCustomSidePanelStore.setState({ activeByProject: {} });
  vi.mocked(useCustomSidePanel).mockReturnValue({
    data: { path: "panel/index.html" },
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

describe("CustomSidePanel view switch", () => {
  it("replaces the default content with a transparent borderless iframe when active and configured", async () => {
    const view = renderWithProviders(
      <CustomSidePanel>
        <div>default panel content</div>
      </CustomSidePanel>,
    );
    await connectMockBus();

    expect(screen.queryByText("default panel content")).not.toBeInTheDocument();
    const iframe = screen.getByTitle("侧边面板");
    expect(iframe).toHaveAttribute(
      "src",
      "http://localhost:5173/api/projects/p1/preview/panel/index.html",
    );
    expect(iframe.className).not.toContain("bg-");
    view.unmount();
  });

  it("falls back to the default content when no path is configured", async () => {
    vi.mocked(useCustomSidePanel).mockReturnValue({
      data: { path: null },
      isError: false,
    } as never);
    const view = renderWithProviders(
      <CustomSidePanel>
        <div>default panel content</div>
      </CustomSidePanel>,
    );
    await connectMockBus();

    expect(screen.getByText("default panel content")).toBeInTheDocument();
    expect(screen.queryByTitle("侧边面板")).not.toBeInTheDocument();
    view.unmount();
  });

  it("falls back to the default content when explicitly hidden", async () => {
    useCustomSidePanelStore.getState().setActive("p1", false);
    const view = renderWithProviders(
      <CustomSidePanel>
        <div>default panel content</div>
      </CustomSidePanel>,
    );
    await connectMockBus();

    expect(screen.getByText("default panel content")).toBeInTheDocument();
    expect(screen.queryByTitle("侧边面板")).not.toBeInTheDocument();
    view.unmount();
  });
});

describe("CustomSidePanel iframe reload", () => {
  it("debounces rapid save bursts into a single forced reload via the React key", async () => {
    const view = renderWithProviders(
      <CustomSidePanel>
        <div>default panel content</div>
      </CustomSidePanel>,
    );
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
    const view = renderWithProviders(
      <CustomSidePanel>
        <div>default panel content</div>
      </CustomSidePanel>,
    );
    await connectMockBus();

    const iframeBefore = screen.getByTitle("侧边面板");
    emitFsWatch("other/file.html");
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByTitle("侧边面板")).toBe(iframeBefore);
    view.unmount();
  });

  it("clears the debounce timer on unmount", async () => {
    const { unmount } = renderWithProviders(
      <CustomSidePanel>
        <div>default panel content</div>
      </CustomSidePanel>,
    );
    await connectMockBus();
    const before = vi.getTimerCount();

    emitFsWatch("panel/index.html");
    expect(vi.getTimerCount()).toBe(before + 1);

    unmount();
    expect(vi.getTimerCount()).toBe(before);
  });
});
