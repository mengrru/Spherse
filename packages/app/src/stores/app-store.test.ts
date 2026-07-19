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
    ctx: {
      client: {} as ProjectState["ctx"]["client"],
      baseUrl: "http://localhost:5173",
      projectId: "project-a",
      projectRoot: "/tmp/project-a",
    },
    lastOpened: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const storage = new Map<string, string>();

function setupStoreTest(initializing = false): void {
  vi.resetAllMocks();
  useAppStore.setState({
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
