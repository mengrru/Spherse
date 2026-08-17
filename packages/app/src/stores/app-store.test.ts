import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, type ProjectState } from "./app-store";
import type { HostBridge } from "../lib/host-bridge";

function createMockHostBridge(overrides: Partial<HostBridge> = {}): HostBridge {
  return {
    kind: "electron",
    capabilities: {
      projectManagement: true,
      filePicker: true,
      appUpdate: true,
      devTools: true,
      mobileAccess: false,
      openFileExternal: false,
      settings: { editable: true, scope: "local-only" },
      content: { editable: true },
    },
    getServerBaseUrl: vi.fn().mockResolvedValue("http://localhost:5173"),
    getSettings: vi.fn().mockResolvedValue(null),
    saveSettings: vi.fn().mockResolvedValue({ success: true }),
    openExternal: vi.fn(),
    project: {
      selectDirectory: vi.fn(),
      selectSkillZip: vi.fn(),
      openProject: vi.fn(),
      restoreProjects: vi.fn(),
      addOpenProject: vi.fn(),
      closeProject: vi.fn(),
      openProjectFolder: vi.fn(),
      openFileExternal: vi.fn(),
      setLastActiveProject: vi.fn(),
      getLastActiveProject: vi.fn(),
      openSampleProject: vi.fn(),
      getSampleManifest: vi.fn(),
    },
    ...overrides,
  } as HostBridge;
}

const LAST_ROUTE_KEY = "spherse:last-route:project-a";

function projectState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: "project-a",
    path: "/tmp/project-a",
    name: "project-a",
    lastOpened: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const storage = new Map<string, string>();

function setupStoreTest(initializing = false): void {
  vi.resetAllMocks();
  useAppStore.setState({
    connection: { baseUrl: "http://localhost:5173", accessToken: null },
    projects: new Map(),
    activeProjectId: null,
    initializing,
  });
}

describe("useAppStore lastRoute", () => {
  beforeEach(() => {
    setupStoreTest(true);
    storage.clear();
    vi.stubGlobal("localStorage", {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  it("caches each restored project's last route", async () => {
    const bridge = createMockHostBridge({
      project: {
        selectDirectory: vi.fn(),
        selectSkillZip: vi.fn(),
        openProject: vi.fn(),
        restoreProjects: vi.fn().mockResolvedValue([
          {
            id: "project-a",
            path: "/tmp/project-a",
            name: "project-a",
            lastOpened: "2026-01-01T00:00:00.000Z",
          },
        ]),
        addOpenProject: vi.fn(),
        closeProject: vi.fn(),
        openProjectFolder: vi.fn(),
        openFileExternal: vi.fn(),
        setLastActiveProject: vi.fn(),
        getLastActiveProject: vi.fn().mockResolvedValue("project-a"),
        openSampleProject: vi.fn(),
        getSampleManifest: vi.fn(),
      },
    });
    localStorage.setItem(LAST_ROUTE_KEY, "/chat/session-1");

    const activeProjectId = await useAppStore.getState().restoreProjects(bridge);

    expect(activeProjectId).toBe("project-a");
    expect(useAppStore.getState().projects.get("project-a")?.lastRoute).toBe(
      "/chat/session-1",
    );
  });

  it("persists and updates a project's last route", async () => {
    useAppStore.setState({
      projects: new Map([["project-a", projectState()]]),
      activeProjectId: "project-a",
      initializing: false,
    });

    await useAppStore
      .getState()
      .setProjectLastRoute("project-a", "/content?path=foo.md");

    expect(localStorage.getItem(LAST_ROUTE_KEY)).toBe("/content?path=foo.md");
    expect(useAppStore.getState().projects.get("project-a")?.lastRoute).toBe(
      "/content?path=foo.md",
    );
  });

  it("suppresses duplicate same-route updates", async () => {
    useAppStore.setState({
      projects: new Map([["project-a", projectState()]]),
      activeProjectId: "project-a",
      initializing: false,
    });
    const setItemSpy = vi.spyOn(localStorage, "setItem");

    await useAppStore
      .getState()
      .setProjectLastRoute("project-a", "/content?path=foo.md");
    await useAppStore
      .getState()
      .setProjectLastRoute("project-a", "/content?path=foo.md");

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().projects.get("project-a")?.lastRoute).toBe(
      "/content?path=foo.md",
    );
  });
});

describe("useAppStore refreshConnection", () => {
  beforeEach(() => {
    setupStoreTest(false);
  });

  it("updates app-wide connection when bridge returns a new token", async () => {
    const bridge = createMockHostBridge({
      getServerAccessToken: vi.fn().mockResolvedValue("new-token-xyz"),
    });
    useAppStore.setState({
      projects: new Map([["project-a", projectState()]]),
      activeProjectId: "project-a",
      initializing: false,
    });

    await useAppStore.getState().refreshConnection(bridge);

    expect(bridge.getServerAccessToken).toHaveBeenCalled();
    expect(useAppStore.getState().connection).toEqual({
      baseUrl: "http://localhost:5173",
      accessToken: "new-token-xyz",
    });
  });

  it("preserves projects map (no per-project rebuild)", async () => {
    const bridge = createMockHostBridge({
      getServerAccessToken: vi.fn().mockResolvedValue("tok"),
    });
    const before = new Map([["project-a", projectState()]]);
    useAppStore.setState({
      projects: before,
      activeProjectId: "project-a",
      initializing: false,
    });

    await useAppStore.getState().refreshConnection(bridge);

    expect(useAppStore.getState().projects).toBe(before);
  });
});

describe("useAppStore openSampleProject", () => {
  beforeEach(() => {
    setupStoreTest(false);
  });

  it("registers the project on success and returns its id", async () => {
    const addOpenProject = vi.fn();
    const setLastActiveProject = vi.fn();
    const bridge = createMockHostBridge({
      project: {
        selectDirectory: vi.fn(),
        selectSkillZip: vi.fn(),
        openProject: vi.fn(),
        restoreProjects: vi.fn(),
        addOpenProject,
        closeProject: vi.fn(),
        openProjectFolder: vi.fn(),
        openFileExternal: vi.fn(),
        setLastActiveProject,
        getLastActiveProject: vi.fn(),
        openSampleProject: vi.fn().mockResolvedValue({
          projectId: "sample-1",
          path: "/tmp/sample-world",
        }),
        getSampleManifest: vi.fn(),
      },
    });

    const result = await useAppStore.getState().openSampleProject(bridge, "starter");

    expect(bridge.project?.openSampleProject).toHaveBeenCalledWith({
      sampleId: "starter",
    });
    expect(result).toEqual({ projectId: "sample-1" });
    expect(useAppStore.getState().projects.get("sample-1")).toMatchObject({
      id: "sample-1",
      path: "/tmp/sample-world",
      name: "sample-world",
    });
    expect(useAppStore.getState().activeProjectId).toBe("sample-1");
    expect(addOpenProject).toHaveBeenCalledWith(
      "sample-1",
      "/tmp/sample-world",
    );
    expect(setLastActiveProject).toHaveBeenCalledWith("sample-1");
  });

  it("returns the error and writes nothing when main reports an error", async () => {
    const addOpenProject = vi.fn();
    const bridge = createMockHostBridge({
      project: {
        selectDirectory: vi.fn(),
        selectSkillZip: vi.fn(),
        openProject: vi.fn(),
        restoreProjects: vi.fn(),
        addOpenProject,
        closeProject: vi.fn(),
        openProjectFolder: vi.fn(),
        openFileExternal: vi.fn(),
        setLastActiveProject: vi.fn(),
        getLastActiveProject: vi.fn(),
        openSampleProject: vi.fn().mockResolvedValue({ error: "sample.missing" }),
        getSampleManifest: vi.fn(),
      },
    });

    const result = await useAppStore.getState().openSampleProject(bridge, "starter");

    expect(result).toEqual({ projectId: null, error: "sample.missing" });
    expect(useAppStore.getState().projects.size).toBe(0);
    expect(addOpenProject).not.toHaveBeenCalled();
  });

  it("returns a null id and writes nothing when the user cancels", async () => {
    const addOpenProject = vi.fn();
    const bridge = createMockHostBridge({
      project: {
        selectDirectory: vi.fn(),
        selectSkillZip: vi.fn(),
        openProject: vi.fn(),
        restoreProjects: vi.fn(),
        addOpenProject,
        closeProject: vi.fn(),
        openProjectFolder: vi.fn(),
        openFileExternal: vi.fn(),
        setLastActiveProject: vi.fn(),
        getLastActiveProject: vi.fn(),
        openSampleProject: vi.fn().mockResolvedValue(null),
        getSampleManifest: vi.fn(),
      },
    });

    const result = await useAppStore.getState().openSampleProject(bridge, "starter");

    expect(result).toEqual({ projectId: null });
    expect(useAppStore.getState().projects.size).toBe(0);
  });
});

describe("useAppStore refreshProjects", () => {
  beforeEach(() => {
    setupStoreTest(false);
    storage.clear();
    vi.stubGlobal("localStorage", {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  function bridgeWithProjects(restored: Array<{ id: string; path: string; name: string; lastOpened?: string }>) {
    return createMockHostBridge({
      project: {
        selectDirectory: vi.fn(),
        selectSkillZip: vi.fn(),
        openProject: vi.fn(),
        restoreProjects: vi.fn().mockResolvedValue(restored),
        addOpenProject: vi.fn(),
        closeProject: vi.fn(),
        openProjectFolder: vi.fn(),
        openFileExternal: vi.fn(),
        setLastActiveProject: vi.fn(),
        getLastActiveProject: vi.fn(),
        openSampleProject: vi.fn(),
        getSampleManifest: vi.fn(),
      },
    });
  }

  it("merges new/updated/removed projects without flipping initializing", async () => {
    useAppStore.setState({
      projects: new Map([
        ["project-a", projectState({ lastRoute: "/chat/s1" })],
        ["project-gone", projectState({ id: "project-gone", name: "gone" })],
      ]),
      activeProjectId: "project-a",
      initializing: false,
    });

    const bridge = bridgeWithProjects([
      { id: "project-a", path: "/tmp/project-a", name: "project-a", lastOpened: "2026-02-02T00:00:00.000Z" },
      { id: "project-b", path: "/tmp/project-b", name: "project-b", lastOpened: "2026-02-02T00:00:00.000Z" },
    ]);

    await useAppStore.getState().refreshProjects(bridge);

    const state = useAppStore.getState();
    expect(state.initializing).toBe(false);
    expect([...state.projects.keys()].sort()).toEqual(["project-a", "project-b"]);
    expect(state.projects.get("project-a")?.lastRoute).toBe("/chat/s1");
    expect(state.projects.get("project-a")?.lastOpened).toBe("2026-02-02T00:00:00.000Z");
    expect(state.projects.get("project-b")?.name).toBe("project-b");
    expect(state.activeProjectId).toBe("project-a");
  });

  it("falls back to another project when the active project disappeared", async () => {
    useAppStore.setState({
      projects: new Map([["project-gone", projectState({ id: "project-gone", name: "gone" })]]),
      activeProjectId: "project-gone",
    });

    const bridge = bridgeWithProjects([
      { id: "project-b", path: "/tmp/project-b", name: "project-b" },
    ]);

    await useAppStore.getState().refreshProjects(bridge);

    expect(useAppStore.getState().activeProjectId).toBe("project-b");
  });

  it("persists the fallback project when the active project disappeared", async () => {
    useAppStore.setState({
      projects: new Map([["project-gone", projectState({ id: "project-gone", name: "gone" })]]),
      activeProjectId: "project-gone",
    });

    const setLastActiveProject = vi.fn();
    const bridge = createMockHostBridge({
      project: {
        selectDirectory: vi.fn(),
        selectSkillZip: vi.fn(),
        openProject: vi.fn(),
        restoreProjects: vi.fn().mockResolvedValue([
          { id: "project-b", path: "/tmp/project-b", name: "project-b" },
        ]),
        addOpenProject: vi.fn(),
        closeProject: vi.fn(),
        openProjectFolder: vi.fn(),
        openFileExternal: vi.fn(),
        setLastActiveProject,
        getLastActiveProject: vi.fn(),
        openSampleProject: vi.fn(),
        getSampleManifest: vi.fn(),
      },
    });

    await useAppStore.getState().refreshProjects(bridge);

    expect(setLastActiveProject).toHaveBeenCalledWith("project-b");
  });

  it("keeps a project registered locally while the fetch was in flight", async () => {
    useAppStore.setState({
      projects: new Map([["project-a", projectState()]]),
      activeProjectId: "project-a",
    });

    let resolveRestore: (value: Array<{ id: string; path: string; name: string }>) => void;
    const restoreProjects = vi.fn().mockImplementation(
      () => new Promise<Array<{ id: string; path: string; name: string }>>((resolve) => {
        resolveRestore = resolve;
      }),
    );
    const bridge = createMockHostBridge({
      project: {
        selectDirectory: vi.fn(),
        selectSkillZip: vi.fn(),
        openProject: vi.fn(),
        restoreProjects,
        addOpenProject: vi.fn(),
        closeProject: vi.fn(),
        openProjectFolder: vi.fn(),
        openFileExternal: vi.fn(),
        setLastActiveProject: vi.fn(),
        getLastActiveProject: vi.fn(),
        openSampleProject: vi.fn(),
        getSampleManifest: vi.fn(),
      },
    });

    const pending = useAppStore.getState().refreshProjects(bridge);
    // Wait until the in-flight fetch actually started (after connection
    // resolution), then simulate a concurrent local open.
    await vi.waitFor(() => {
      if (!resolveRestore) throw new Error("restoreProjects not called yet");
    });
    // User opens a new project while the snapshot request is in flight.
    useAppStore.setState((state) => ({
      projects: new Map(state.projects).set("project-new", projectState({
        id: "project-new",
        name: "project-new",
        lastOpened: new Date().toISOString(),
      })),
      activeProjectId: "project-new",
    }));
    resolveRestore!([{ id: "project-a", path: "/tmp/project-a", name: "project-a" }]);
    await pending;

    const state = useAppStore.getState();
    expect(state.projects.get("project-new")).toBeDefined();
    expect(state.activeProjectId).toBe("project-new");
  });

  it("keeps state untouched and rethrows when the fetch fails", async () => {
    useAppStore.setState({
      projects: new Map([["project-a", projectState()]]),
      activeProjectId: "project-a",
    });

    const bridge = createMockHostBridge({
      project: {
        selectDirectory: vi.fn(),
        selectSkillZip: vi.fn(),
        openProject: vi.fn(),
        restoreProjects: vi.fn().mockRejectedValue(new Error("network down")),
        addOpenProject: vi.fn(),
        closeProject: vi.fn(),
        openProjectFolder: vi.fn(),
        openFileExternal: vi.fn(),
        setLastActiveProject: vi.fn(),
        getLastActiveProject: vi.fn(),
        openSampleProject: vi.fn(),
        getSampleManifest: vi.fn(),
      },
    });

    await expect(useAppStore.getState().refreshProjects(bridge)).rejects.toThrow("network down");
    expect(useAppStore.getState().projects.get("project-a")).toBeDefined();
    expect(useAppStore.getState().activeProjectId).toBe("project-a");
  });

  it("no-ops (keeping state) when there is no connection baseUrl", async () => {
    const bridge = createMockHostBridge({
      getServerBaseUrl: vi.fn().mockResolvedValue(""),
      project: {
        selectDirectory: vi.fn(),
        selectSkillZip: vi.fn(),
        openProject: vi.fn(),
        restoreProjects: vi.fn(),
        addOpenProject: vi.fn(),
        closeProject: vi.fn(),
        openProjectFolder: vi.fn(),
        openFileExternal: vi.fn(),
        setLastActiveProject: vi.fn(),
        getLastActiveProject: vi.fn(),
        openSampleProject: vi.fn(),
        getSampleManifest: vi.fn(),
      },
    });
    await useAppStore.getState().refreshProjects(bridge);
    expect(bridge.project?.restoreProjects).not.toHaveBeenCalled();
  });
});
