import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, type ProjectState } from "./app-store";

const electronAPI = {
  selectDirectory: vi.fn(),
  getServerPort: vi.fn().mockResolvedValue(5173),
  restoreProjects: vi.fn(),
  openProject: vi.fn(),
  createNewProject: vi.fn(),
  openSampleProject: vi.fn(),
  addOpenProject: vi.fn(),
  closeProject: vi.fn(),
  openProjectFolder: vi.fn(),
  setLastActiveProject: vi.fn(),
  getLastActiveProject: vi.fn(),
};

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
  electronAPI.getServerPort.mockResolvedValue(5173);
  vi.stubGlobal("localStorage", {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  localStorage.clear();
  Object.defineProperty(globalThis, "window", {
    value: { electronAPI },
    configurable: true,
  });
  useAppStore.setState({
    projects: new Map(),
    activeProjectId: null,
    initializing,
  });
}

describe("useAppStore lastRoute", () => {
  beforeEach(() => {
    setupStoreTest(true);
  });

  it("caches each restored project's last route", async () => {
    localStorage.setItem(LAST_ROUTE_KEY, "/chat/session-1");
    electronAPI.restoreProjects.mockResolvedValue([
      {
        id: "project-a",
        path: "/tmp/project-a",
        name: "project-a",
        lastOpened: "2026-01-01T00:00:00.000Z",
      },
    ]);
    electronAPI.getLastActiveProject.mockResolvedValue("project-a");

    const activeProjectId = await useAppStore.getState().restoreProjects();

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

describe("useAppStore createNewProject", () => {
  beforeEach(() => {
    setupStoreTest(false);
  });

  it("registers the project on success and returns its id", async () => {
    electronAPI.createNewProject.mockResolvedValue({
      projectId: "new-1",
      path: "/tmp/new-project",
    });

    const result = await useAppStore.getState().createNewProject();

    expect(result).toEqual({ projectId: "new-1" });
    const project = useAppStore.getState().projects.get("new-1");
    expect(project).toMatchObject({
      id: "new-1",
      path: "/tmp/new-project",
      name: "new-project",
    });
    expect(project?.ctx).toEqual({
      client: expect.anything(),
      baseUrl: "http://localhost:5173",
      projectId: "new-1",
      projectRoot: "/tmp/new-project",
    });
    expect(useAppStore.getState().activeProjectId).toBe("new-1");
    expect(electronAPI.addOpenProject).toHaveBeenCalledWith(
      "new-1",
      "/tmp/new-project",
    );
    expect(electronAPI.setLastActiveProject).toHaveBeenCalledWith("new-1");
  });

  it("returns the error and writes nothing when main reports an error", async () => {
    electronAPI.createNewProject.mockResolvedValue({ error: "create.failed" });

    const result = await useAppStore.getState().createNewProject();

    expect(result).toEqual({ projectId: null, error: "create.failed" });
    expect(useAppStore.getState().projects.size).toBe(0);
    expect(useAppStore.getState().activeProjectId).toBeNull();
    expect(electronAPI.getServerPort).not.toHaveBeenCalled();
    expect(electronAPI.addOpenProject).not.toHaveBeenCalled();
    expect(electronAPI.setLastActiveProject).not.toHaveBeenCalled();
  });

  it("returns a null id and writes nothing when the user cancels", async () => {
    electronAPI.createNewProject.mockResolvedValue(null);

    const result = await useAppStore.getState().createNewProject();

    expect(result).toEqual({ projectId: null });
    expect(useAppStore.getState().projects.size).toBe(0);
    expect(electronAPI.getServerPort).not.toHaveBeenCalled();
    expect(electronAPI.addOpenProject).not.toHaveBeenCalled();
  });
});

describe("useAppStore openSampleProject", () => {
  beforeEach(() => {
    setupStoreTest(false);
  });

  it("registers the project on success and returns its id", async () => {
    electronAPI.openSampleProject.mockResolvedValue({
      projectId: "sample-1",
      path: "/tmp/sample-world",
    });

    const result = await useAppStore.getState().openSampleProject("starter");

    expect(electronAPI.openSampleProject).toHaveBeenCalledWith({
      sampleId: "starter",
    });
    expect(result).toEqual({ projectId: "sample-1" });
    expect(useAppStore.getState().projects.get("sample-1")).toMatchObject({
      id: "sample-1",
      path: "/tmp/sample-world",
      name: "sample-world",
    });
    expect(useAppStore.getState().activeProjectId).toBe("sample-1");
    expect(electronAPI.addOpenProject).toHaveBeenCalledWith(
      "sample-1",
      "/tmp/sample-world",
    );
    expect(electronAPI.setLastActiveProject).toHaveBeenCalledWith("sample-1");
  });

  it("returns the error and writes nothing when main reports an error", async () => {
    electronAPI.openSampleProject.mockResolvedValue({ error: "sample.missing" });

    const result = await useAppStore.getState().openSampleProject("starter");

    expect(result).toEqual({ projectId: null, error: "sample.missing" });
    expect(useAppStore.getState().projects.size).toBe(0);
    expect(electronAPI.addOpenProject).not.toHaveBeenCalled();
  });

  it("returns a null id and writes nothing when the user cancels", async () => {
    electronAPI.openSampleProject.mockResolvedValue(null);

    const result = await useAppStore.getState().openSampleProject("starter");

    expect(result).toEqual({ projectId: null });
    expect(useAppStore.getState().projects.size).toBe(0);
  });
});
