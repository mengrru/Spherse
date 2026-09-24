import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@spherse/i18n/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { ProjectProvider } from "../../context/project-context";
import { projectQueryKeys } from "../../queries/keys";
import { useFloatingChatStore } from "../floating-chat/store";
import { getDefaultFloatingState } from "../floating-chat";
import { useSelectionSessionHandlers } from "./use-selection-session-handlers";

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({}),
  useConnection: () => ({ baseUrl: "http://localhost", accessToken: null }),
}));

function setup(route: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(projectQueryKeys.agents("p1"), [{ id: "a1", name: "Agent One" }]);
  queryClient.setQueryData(projectQueryKeys.sessions("p1"), {
    sessions: [
      { id: "s1", agentId: "a1", title: "Current", createdAt: 1, updatedAt: 1, status: "active" },
      { id: "s2", agentId: "a1", title: "Floating", createdAt: 2, updatedAt: 2, status: "active" },
    ],
    paging: {},
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider locale="en">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <ProjectProvider projectId="p1" projectRoot="/tmp/p1">
            <Routes>
              <Route path="/project/:projectId/*" element={children} />
            </Routes>
          </ProjectProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>
  );
  return renderHook(() => useSelectionSessionHandlers(), { wrapper });
}

describe("useSelectionSessionHandlers", () => {
  beforeEach(() => {
    useFloatingChatStore.setState({ byProject: {} });
  });

  it("offers the main-pane chat as the current session", () => {
    const { result } = setup("/project/p1/chat/s1");
    expect(result.current.activeSessions).toEqual([
      { sessionId: "s1", agentName: "Agent One", sessionTitle: "Current", floating: false },
    ]);
  });

  it("lists the current session before the floating one", () => {
    useFloatingChatStore.setState({ byProject: { p1: getDefaultFloatingState("s2") } });
    const { result } = setup("/project/p1/chat/s1");
    expect(result.current.activeSessions.map((s) => [s.sessionId, s.floating])).toEqual([
      ["s1", false],
      ["s2", true],
    ]);
  });

  it("dedupes when the floating session is the current one", () => {
    useFloatingChatStore.setState({ byProject: { p1: getDefaultFloatingState("s1") } });
    const { result } = setup("/project/p1/chat/s1");
    expect(result.current.activeSessions).toHaveLength(1);
    expect(result.current.activeSessions[0].floating).toBe(false);
  });

  it("only offers the floating session on non-chat routes", () => {
    useFloatingChatStore.setState({ byProject: { p1: getDefaultFloatingState("s2") } });
    const { result } = setup("/project/p1/content?path=a.md");
    expect(result.current.activeSessions).toEqual([
      { sessionId: "s2", agentName: "Agent One", sessionTitle: "Floating", floating: true },
    ]);
  });
});
