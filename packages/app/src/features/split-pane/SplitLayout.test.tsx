import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@spherse/i18n/react";
import { useState } from "react";
import { Outlet, RouterProvider, createMemoryRouter, useBlocker, useLocation, useParams, useSearchParams } from "react-router";
import { HostBridgeProvider } from "../../context/host-bridge-context";
import { ProjectProvider } from "../../context/project-context";
import { CONTENT_ERROR_CODES } from "@spherse/contracts";
import { ApiError } from "../../lib/api";
import { createMockHostBridge } from "../../test/host-bridge";
import { projectQueryKeys } from "../../queries/keys";
import { useSettingsStore } from "../../stores/settings-store";
import { TabBar, TabRouteBridge } from "../tabs";
import { useTabsStore } from "../tabs/store";
import { SplitLayout } from "./SplitLayout";
import { SplitRouteBridge } from "./SplitRouteBridge";
import { useOpenSplit } from "./hooks";
import { useSplitPaneStore } from "./store";
import { getProjectNavStack, recordProjectNavLocation, clearProjectNavHistory } from "../../lib/use-project-navigation";

const readContent = vi.fn();

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    readContent,
    getContent: vi.fn(),
    getPreviewUrl: (path: string) => `http://localhost/preview/${path}`,
  }),
  useConnection: () => ({ baseUrl: "http://localhost", accessToken: null }),
}));

function Layout() {
  const { projectId = "" } = useParams();
  return (
    <ProjectProvider projectId={projectId} projectRoot="/tmp/p1">
      <SplitLayout>
        <TabBar />
        <Outlet />
      </SplitLayout>
      <TabRouteBridge />
      <SplitRouteBridge />
    </ProjectProvider>
  );
}

function Page({ name }: { name: string }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [count, setCount] = useState(0);
  const openSplit = useOpenSplit();
  return (
    <div>
      <p data-testid="page">{name}:{location.pathname}{location.search}</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>count:{count}</button>
      <button type="button" onClick={() => openSplit(searchParams.get("path") ?? "")}>split-current</button>
      <button type="button" onClick={() => openSplit("other.md")}>split-other</button>
    </div>
  );
}

function BlockingPage() {
  const blocker = useBlocker(true);
  const openSplit = useOpenSplit();
  return (
    <div>
      <p data-testid="blocker">{blocker.state}</p>
      <button type="button" onClick={() => openSplit("a.md")}>split-current</button>
      {blocker.state === "blocked" && <button type="button" onClick={() => blocker.reset()}>stay</button>}
      {blocker.state === "blocked" && <button type="button" onClick={() => blocker.proceed()}>leave</button>}
    </div>
  );
}

function setup(initial = "/project/p1", contentElement = <Page name="content" />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(projectQueryKeys.agents("p1"), []);
  queryClient.setQueryData(projectQueryKeys.sessions("p1"), { sessions: [], paging: {} });
  const router = createMemoryRouter(
    [
      {
        path: "/project/:projectId",
        element: <Layout />,
        children: [
          { index: true, element: <Page name="welcome" /> },
          { path: "chat/:sessionId", element: <Page name="chat" /> },
          { path: "content", element: contentElement },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  render(
    <I18nProvider locale="en">
      <HostBridgeProvider bridge={createMockHostBridge()}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </HostBridgeProvider>
    </I18nProvider>,
  );
  return { router };
}

const split = () => useSplitPaneStore.getState().byProject.p1;

describe("SplitLayout", () => {
  beforeEach(() => {
    localStorage.clear();
    readContent.mockReset();
    readContent.mockImplementation(async (path: string) => ({ path, content: `# ${path}`, binary: false }));
    useTabsStore.setState({ byProject: {} });
    useSplitPaneStore.setState({ byProject: {} });
    useSettingsStore.setState({ loaded: true, tabsEnabled: true });
  });

  it("renders only the main column without a split", () => {
    setup();
    expect(screen.getByTestId("page")).toHaveTextContent("welcome");
    expect(screen.queryByRole("separator")).toBeNull();
    expect(document.querySelector("[data-split-pane]")).toBeNull();
  });

  it("shows the split file read-only without back / edit buttons and keeps the main page mounted", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "count:0" }));
    act(() => useSplitPaneStore.getState().openSplit("p1", "docs/a.md"));

    const pane = document.querySelector("[data-split-pane]") as HTMLElement;
    expect(pane).not.toBeNull();
    expect(await screen.findByText("docs/a.md")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Split" })).toBeNull();
    expect(screen.getByRole("button", { name: "count:1" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(split()).toBeUndefined();
    expect(document.querySelector("[data-split-pane]")).toBeNull();
    expect(screen.getByRole("button", { name: "count:1" })).toBeInTheDocument();
  });

  it("adjusts the ratio with arrow keys", async () => {
    setup();
    act(() => useSplitPaneStore.getState().openSplit("p1", "a.md"));
    const separator = screen.getByRole("separator");
    separator.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(split().ratio).toBeCloseTo(0.55);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(split().ratio).toBeCloseTo(0.45);
    fireEvent.doubleClick(separator);
    expect(split().ratio).toBeCloseTo(0.5);
  });

  it("ends the split when the file no longer exists", async () => {
    readContent.mockRejectedValue(new ApiError("Not found", 404, CONTENT_ERROR_CODES.FILE_NOT_FOUND));
    setup();
    act(() => useSplitPaneStore.getState().openSplit("p1", "gone.md"));
    await waitFor(() => expect(split()).toBeUndefined());
  });

  it("does not render the split on mobile widths", () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    try {
      setup();
      act(() => useSplitPaneStore.getState().openSplit("p1", "a.md"));
      expect(document.querySelector("[data-split-pane]")).toBeNull();
      expect(split()).toBeDefined();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });

  it("keeps the split on non-404 errors", async () => {
    readContent.mockRejectedValue(new ApiError("boom", 500));
    setup();
    act(() => useSplitPaneStore.getState().openSplit("p1", "a.md"));
    expect(await screen.findByText("boom", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(split()).toEqual({ filePath: "a.md", ratio: 0.5 });
  });
});

describe("useOpenSplit", () => {
  beforeEach(() => {
    clearProjectNavHistory("p1");
    localStorage.clear();
    readContent.mockReset();
    readContent.mockImplementation(async (path: string) => ({ path, content: `# ${path}`, binary: false }));
    useTabsStore.setState({ byProject: {} });
    useSplitPaneStore.setState({ byProject: {} });
    useSettingsStore.setState({ loaded: true, tabsEnabled: true });
  });

  it("opens another file without leaving the current page", async () => {
    setup("/project/p1/content?path=a.md");
    await userEvent.click(screen.getByRole("button", { name: "split-other" }));
    expect(split()?.filePath).toBe("other.md");
    expect(screen.getByTestId("page")).toHaveTextContent("content:/project/p1/content?path=a.md");
  });

  it("moves the current file: closes its tab and opens the split after navigation", async () => {
    const { router } = setup("/project/p1/chat/s1");
    await act(() => router.navigate("/project/p1/content?path=a.md"));
    await userEvent.click(screen.getByRole("button", { name: "split-current" }));

    await waitFor(() => expect(split()?.filePath).toBe("a.md"));
    expect(screen.getByTestId("page")).toHaveTextContent("chat:/project/p1/chat/s1");
    expect(useTabsStore.getState().byProject.p1).toEqual([{ kind: "chat", sessionId: "s1" }]);
    await waitFor(() => expect(router.state.location.state).toBeNull());
  });

  it("moves the current file to the welcome page when tabs are disabled", async () => {
    useSettingsStore.setState({ loaded: true, tabsEnabled: false });
    const { router } = setup("/project/p1/content?path=a.md");
    recordProjectNavLocation("p1", "/project/p1/chat/s1");
    recordProjectNavLocation("p1", "/project/p1/content?path=a.md");
    await userEvent.click(screen.getByRole("button", { name: "split-current" }));

    await waitFor(() => expect(split()?.filePath).toBe("a.md"));
    expect(screen.getByTestId("page")).toHaveTextContent("welcome:/project/p1");
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(getProjectNavStack("p1")).toEqual(["/project/p1/chat/s1"]);
  });

  it("does not open the split when leaving is blocked", async () => {
    setup("/project/p1/content?path=a.md", <BlockingPage />);
    await userEvent.click(screen.getByRole("button", { name: "split-current" }));
    expect(screen.getByTestId("blocker")).toHaveTextContent("blocked");
    await userEvent.click(screen.getByRole("button", { name: "stay" }));
    expect(split()).toBeUndefined();
  });

  it("opens the split once leaving is confirmed", async () => {
    setup("/project/p1/content?path=a.md", <BlockingPage />);
    await userEvent.click(screen.getByRole("button", { name: "split-current" }));
    await userEvent.click(screen.getByRole("button", { name: "leave" }));
    await waitFor(() => expect(split()?.filePath).toBe("a.md"));
    expect(screen.getByTestId("page")).toHaveTextContent("welcome:/project/p1");
  });
});
