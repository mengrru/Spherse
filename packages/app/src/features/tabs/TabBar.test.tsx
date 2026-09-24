import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@spherse/i18n/react";
import { Outlet, RouterProvider, createMemoryRouter, useLocation, useParams } from "react-router";
import { HostBridgeProvider } from "../../context/host-bridge-context";
import { ProjectProvider } from "../../context/project-context";
import { createMockHostBridge } from "../../test/host-bridge";
import { projectQueryKeys } from "../../queries/keys";
import { useSettingsStore } from "../../stores/settings-store";
import { useTabsStore } from "../../stores/tabs-store";
import { useFloatingChatStore } from "../floating-chat/store";
import { TabBar } from "./TabBar";
import { TabRouteBridge } from "./TabRouteBridge";
import { useCloseActiveTab, useCloseDeletedFileTabs } from "./use-tab-actions";
import {
  clearProjectNavHistory,
  getProjectNavStack,
  recordProjectNavLocation,
} from "../../lib/use-project-navigation";

function Layout() {
  const { projectId = "" } = useParams();
  return (
    <ProjectProvider projectId={projectId} projectRoot="/tmp/p1">
      <TabBar />
      <TabRouteBridge />
      <Outlet />
    </ProjectProvider>
  );
}

function Page({ name }: { name: string }) {
  const location = useLocation();
  const closeActiveTab = useCloseActiveTab();
  const closeDeleted = useCloseDeletedFileTabs();
  return (
    <div>
      <button type="button" onClick={() => closeDeleted("notes")}>delete-notes</button>
      <p data-testid="page">{name}:{location.pathname}{location.search}</p>
      <button type="button" onClick={() => closeActiveTab(() => {})}>header-close</button>
    </div>
  );
}

function setup(initial = "/project/p1", bridge = createMockHostBridge()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(projectQueryKeys.agents("p1"), [{ id: "a1", name: "Agent One" }]);
  queryClient.setQueryData(projectQueryKeys.sessions("p1"), {
    sessions: [
      { id: "s1", agentId: "a1", title: "First chat", createdAt: 1, updatedAt: 1, status: "active" },
      { id: "s2", agentId: "a1", title: "Second chat", createdAt: 2, updatedAt: 2, status: "active" },
    ],
    paging: {},
  });
  const router = createMemoryRouter(
    [
      {
        path: "/project/:projectId",
        element: <Layout />,
        children: [
          { index: true, element: <Page name="welcome" /> },
          { path: "chat/:sessionId", element: <Page name="chat" /> },
          { path: "content", element: <Page name="content" /> },
          { path: "browser", element: <Page name="browser" /> },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  render(
    <I18nProvider locale="en">
      <HostBridgeProvider bridge={bridge}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </HostBridgeProvider>
    </I18nProvider>,
  );
  const go = (to: string) => act(() => router.navigate(to));
  return { router, go, queryClient };
}

function tabNames() {
  return within(screen.getByRole("tablist")).getAllByRole("tab").map((tab) => tab.textContent);
}

describe("TabBar", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState({ byProject: {} });
    useFloatingChatStore.setState({ byProject: {} });
    useSettingsStore.setState({ loaded: true, tabsEnabled: true });
  });

  it("shows only the welcome tab, without a close button, on a fresh project", () => {
    setup();
    expect(tabNames()).toEqual(["Welcome"]);
    expect(screen.getByRole("tab", { name: "Welcome" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: /Close/ })).toBeNull();
  });

  it("adds a tab per opened chat / file / browser page and focuses existing ones", async () => {
    const { go } = setup();
    await go("/project/p1/chat/s1");
    await go("/project/p1/content?path=notes%2Fa.md");
    await go("/project/p1/browser?url=http%3A%2F%2Flocalhost%3A3000%2F");
    await go("/project/p1/chat/s1");

    expect(tabNames()).toEqual(["Welcome", "First chat", "a", "localhost:3000"]);
    expect(screen.getByRole("tab", { name: "First chat" })).toHaveAttribute("aria-selected", "true");
  });

  it("navigates when a tab is clicked", async () => {
    const { go } = setup();
    await go("/project/p1/chat/s1");
    await go("/project/p1/content?path=a.md");
    await userEvent.click(screen.getByRole("tab", { name: "First chat" }));

    expect(screen.getByTestId("page")).toHaveTextContent("chat:/project/p1/chat/s1");
    await userEvent.click(screen.getByRole("tab", { name: "Welcome" }));
    expect(screen.getByTestId("page")).toHaveTextContent("welcome:/project/p1");
  });

  it("closing the active tab goes to the right neighbor, then left, then welcome", async () => {
    const { go } = setup();
    await go("/project/p1/chat/s1");
    await go("/project/p1/chat/s2");
    await go("/project/p1/content?path=a.md");
    await userEvent.click(screen.getByRole("tab", { name: "First chat" }));

    await userEvent.click(screen.getByRole("button", { name: "Close First chat" }));
    expect(screen.getByTestId("page")).toHaveTextContent("chat:/project/p1/chat/s2");
    expect(tabNames()).toEqual(["Welcome", "Second chat", "a"]);

    await userEvent.click(screen.getByRole("tab", { name: "a" }));
    await userEvent.click(screen.getByRole("button", { name: "Close a" }));
    expect(screen.getByTestId("page")).toHaveTextContent("chat:/project/p1/chat/s2");

    await userEvent.click(screen.getByRole("button", { name: "Close Second chat" }));
    expect(screen.getByTestId("page")).toHaveTextContent("welcome:/project/p1");
    expect(tabNames()).toEqual(["Welcome"]);
  });

  it("closing an inactive tab keeps the current page", async () => {
    const { go } = setup();
    await go("/project/p1/chat/s1");
    await go("/project/p1/chat/s2");
    await userEvent.click(screen.getByRole("button", { name: "Close First chat" }));

    expect(screen.getByTestId("page")).toHaveTextContent("chat:/project/p1/chat/s2");
    expect(tabNames()).toEqual(["Welcome", "Second chat"]);
  });

  it("header close closes the active tab", async () => {
    const { go } = setup();
    await go("/project/p1/chat/s1");
    await go("/project/p1/chat/s2");
    await userEvent.click(screen.getByRole("button", { name: "header-close" }));

    expect(screen.getByTestId("page")).toHaveTextContent("chat:/project/p1/chat/s1");
    expect(tabNames()).toEqual(["Welcome", "First chat"]);
  });

  it("replaces the current browser tab on in-page navigation and forgets the old url", async () => {
    clearProjectNavHistory("p1");
    const oldUrl = "/project/p1/browser?url=http%3A%2F%2Flocalhost%3A1%2F";
    recordProjectNavLocation("p1", oldUrl);
    const { router } = setup(oldUrl);
    await act(() => router.navigate("/project/p1/browser?url=http%3A%2F%2Flocalhost%3A2%2F", {
      replace: true,
      state: { replaceTab: "browser:http://localhost:1/", closedUrl: oldUrl },
    }));

    expect(tabNames()).toEqual(["Welcome", "localhost:2"]);
    expect(getProjectNavStack("p1")).not.toContain(oldUrl);
  });

  it("skips hidden browser tabs when picking the neighbor of a closed tab", async () => {
    useTabsStore.setState({
      byProject: {
        p1: [
          { kind: "chat", sessionId: "s1" },
          { kind: "browser", url: "http://localhost:1/" },
          { kind: "file", path: "a.md" },
        ],
      },
    });
    setup("/project/p1/chat/s1", createMockHostBridge({ kind: "web" }));
    expect(tabNames()).toEqual(["Welcome", "First chat", "a"]);

    await userEvent.click(screen.getByRole("button", { name: "Close First chat" }));
    expect(screen.getByTestId("page")).toHaveTextContent("content:/project/p1/content?path=a.md");
  });

  it("does not create tabs for rejected browser urls or floating sessions", async () => {
    useFloatingChatStore.setState({ byProject: { p1: { sessionId: "s2" } } } as never);
    const { go } = setup();
    await go("/project/p1/browser?url=https%3A%2F%2Fexample.com%2F");
    await go("/project/p1/chat/s2");

    expect(tabNames()).toEqual(["Welcome"]);
  });

  it("restores tabs of each project from the store", async () => {
    useTabsStore.setState({
      byProject: {
        p1: [{ kind: "file", path: "a.md" }],
        p2: [{ kind: "file", path: "b.md" }],
      },
    });
    const { go } = setup();
    expect(tabNames()).toEqual(["Welcome", "a"]);
    await go("/project/p2");
    expect(tabNames()).toEqual(["Welcome", "b"]);
  });

  it("drops chat tabs whose session is gone", async () => {
    useTabsStore.setState({ byProject: { p1: [{ kind: "chat", sessionId: "s1" }] } });
    const { queryClient } = setup();
    expect(tabNames()).toEqual(["Welcome", "First chat"]);

    act(() => {
      queryClient.setQueryData(projectQueryKeys.agents("p1"), []);
    });
    await waitFor(() => expect(tabNames()).toEqual(["Welcome"]));
    expect(useTabsStore.getState().byProject.p1).toBeUndefined();
  });

  it("renders nothing and records nothing while disabled, keeping stored tabs", async () => {
    useSettingsStore.setState({ tabsEnabled: false });
    useTabsStore.setState({ byProject: { p1: [{ kind: "file", path: "a.md" }] } });
    const { go } = setup();
    await go("/project/p1/chat/s1");

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(useTabsStore.getState().byProject.p1).toEqual([{ kind: "file", path: "a.md" }]);

    act(() => useSettingsStore.setState({ tabsEnabled: true }));
    expect(tabNames()).toEqual(["Welcome", "a", "First chat"]);
  });

  it("waits for settings to load before recording", async () => {
    useSettingsStore.setState({ loaded: false, tabsEnabled: true });
    setup("/project/p1/chat/s1");
    expect(useTabsStore.getState().byProject.p1).toBeUndefined();
  });

  it("closes tabs of deleted files and moves off a deleted active file to a surviving neighbor", async () => {
    clearProjectNavHistory("p1");
    for (const url of ["/project/p1/content?path=notes%2Fa.md", "/project/p1/content?path=notes%2Fb.md"]) {
      recordProjectNavLocation("p1", url);
    }
    const { go } = setup();
    await go("/project/p1/chat/s1");
    await go("/project/p1/content?path=notes%2Fa.md");
    await go("/project/p1/content?path=notes%2Fb.md");
    await go("/project/p1/content?path=other.md");
    await userEvent.click(screen.getByRole("tab", { name: "a" }));

    await userEvent.click(screen.getByRole("button", { name: "delete-notes" }));

    expect(tabNames()).toEqual(["Welcome", "First chat", "other"]);
    expect(screen.getByTestId("page")).toHaveTextContent("content:/project/p1/content?path=other.md");
    expect(getProjectNavStack("p1").some((url) => url.includes("notes%2F"))).toBe(false);
  });
});
