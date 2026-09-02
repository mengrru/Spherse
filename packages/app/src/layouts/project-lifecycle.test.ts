import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeProjectCascade } from "./project-lifecycle";
import { useAppStore, type ProjectState } from "../stores/app-store";
import { useProjectDataStore } from "../stores/project-data-store";
import { useStreamingStore } from "../features/chat/replica-store";
import { useAgentSessionListUiStore } from "../features/agent-session-list/store";
import { queryClient } from "../queries/client";
import { projectQueryKeys } from "../queries/keys";
import { getLastRoute, setLastRoute } from "../lib/localstorage/last-route";
import { clearProjectNavHistory } from "../lib/use-project-navigation";
import { initialReplica as initialReplicaOf } from "../features/chat/replica/session-replica";
import type { HostBridge } from "../lib/host-bridge";

vi.mock("../lib/use-project-navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/use-project-navigation")>();
  return { ...actual, clearProjectNavHistory: vi.fn() };
});

function project(id: string): ProjectState {
  return { id, path: `/tmp/${id}`, name: id, lastOpened: new Date().toISOString() };
}

function createBridge(closeProjectImpl?: ReturnType<typeof vi.fn>): HostBridge {
  return {
    project: {
      closeProject: closeProjectImpl ?? vi.fn().mockResolvedValue(undefined),
      setLastActiveProject: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as HostBridge;
}

function seedStreamingSession(sessionId: string, projectId: string): void {
  useStreamingStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      [sessionId]: {
        replica: initialReplicaOf(),
        view: { keyed: [], messages: [], streaming: false },
        messages: [],
        streaming: false,
        lastActivityAt: Date.now(),
        scrollPosition: 0,
        attachedCount: 1,
        initialQueued: false,
        projectId,
        hasMore: false,
        loadingMore: false,
        historyStatus: "ready",
        connectionStatus: "open",
        historyError: false,
        reconnectFailed: false,
        client: null,
        agentId: "a1",
        generation: 1,
        syncInFlight: false,
        resendPending: null,
      },
    },
  }));
}

function seedClosedProject(): void {
  const projects = new Map<string, ProjectState>([
    ["p1", project("p1")],
    ["p2", project("p2")],
  ]);
  useAppStore.setState({ projects, activeProjectId: "p1", initializing: false });
  seedStreamingSession("s1", "p1");
  seedStreamingSession("s2", "p2");
  queryClient.setQueryData(projectQueryKeys.sessions("p1"), { sessions: [], paging: {} });
  useAgentSessionListUiStore.getState().setCollapsedAgentIds("p1", ["a1"]);
  useProjectDataStore.getState().setInitialMessage("p1", "s1", "hello");
  setLastRoute("p1", "/chat");
}

describe("closeProjectCascade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    localStorage.clear();
    useAppStore.setState({
      connection: { baseUrl: "http://localhost", accessToken: null },
      projects: new Map(),
      activeProjectId: null,
      initializing: false,
    });
    useStreamingStore.setState({ sessions: {} });
    useProjectDataStore.setState({ projects: {} });
    useAgentSessionListUiStore.setState({ collapsedAgentIdsByProject: {} });
  });

  it("clears every per-project surface and returns the next project id", async () => {
    seedClosedProject();
    const bridge = createBridge();

    const nextProjectId = await closeProjectCascade(bridge, "p1");

    expect(nextProjectId).toBe("p2");
    expect(useAppStore.getState().projects.has("p1")).toBe(false);
    expect(useAppStore.getState().activeProjectId).toBe("p2");
    expect(bridge.project?.setLastActiveProject).toHaveBeenCalledWith("p2");
    expect(useStreamingStore.getState().sessions.s1).toBeUndefined();
    expect(useStreamingStore.getState().sessions.s2).toBeDefined();
    expect(queryClient.getQueryData(projectQueryKeys.sessions("p1"))).toBeUndefined();
    expect(useAgentSessionListUiStore.getState().collapsedAgentIdsByProject.p1).toBeUndefined();
    expect(useProjectDataStore.getState().projects.p1).toBeUndefined();
    expect(getLastRoute("p1")).toBeNull();
    expect(clearProjectNavHistory).toHaveBeenCalledWith("p1");
  });

  it("leaves local state untouched when the host close fails", async () => {
    seedClosedProject();
    const bridge = createBridge(vi.fn().mockRejectedValue(new Error("host close failed")));

    await expect(closeProjectCascade(bridge, "p1")).rejects.toThrow("host close failed");

    expect(useAppStore.getState().projects.has("p1")).toBe(true);
    expect(useAppStore.getState().activeProjectId).toBe("p1");
    expect(useStreamingStore.getState().sessions.s1).toBeDefined();
    expect(queryClient.getQueryData(projectQueryKeys.sessions("p1"))).toBeDefined();
    expect(useAgentSessionListUiStore.getState().collapsedAgentIdsByProject.p1).toBeDefined();
    expect(useProjectDataStore.getState().projects.p1).toBeDefined();
    expect(getLastRoute("p1")).toBe("/chat");
    expect(clearProjectNavHistory).not.toHaveBeenCalled();
  });
});
