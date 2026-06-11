import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, type ProjectState } from "./app-store";

const electronAPI = {
  selectDirectory: vi.fn(),
  startServer: vi.fn(),
  restoreProjects: vi.fn(),
  addOpenProject: vi.fn(),
  closeProject: vi.fn(),
  revealInFinder: vi.fn(),
  setLastActiveProject: vi.fn(),
  getLastActiveProject: vi.fn(),
  setProjectLastRoute: vi.fn(),
};

function projectState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    key: "project-a",
    path: "/tmp/project-a",
    name: "project-a",
    port: 5173,
    ctx: {
      client: {} as ProjectState["ctx"]["client"],
      port: 5173,
      projectRoot: "/tmp/project-a",
    },
    ...overrides,
  };
}

describe("useAppStore lastRoute", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.resetAllMocks();
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
      activeProjectKey: null,
      initializing: true,
      sidePanelPinned: true,
      sidePanelHovered: false,
    });
  });

  it("caches each restored project's last route", async () => {
    electronAPI.restoreProjects.mockResolvedValue([
      {
        path: "/tmp/project-a",
        name: "project-a",
        port: 5173,
        lastRoute: "/chat/session-1",
      },
    ]);
    electronAPI.getLastActiveProject.mockResolvedValue("/tmp/project-a");

    const activeProjectKey = await useAppStore.getState().restoreProjects();

    expect(activeProjectKey).toBe("project-a");
    expect(useAppStore.getState().projects.get("project-a")?.lastRoute).toBe(
      "/chat/session-1",
    );
  });

  it("persists and updates a project's last route", async () => {
    useAppStore.setState({
      projects: new Map([["project-a", projectState()]]),
      activeProjectKey: "project-a",
      initializing: false,
    });

    await useAppStore
      .getState()
      .setProjectLastRoute("project-a", "/content?path=foo.md");

    expect(electronAPI.setProjectLastRoute).toHaveBeenCalledWith(
      "/tmp/project-a",
      "/content?path=foo.md",
    );
    expect(useAppStore.getState().projects.get("project-a")?.lastRoute).toBe(
      "/content?path=foo.md",
    );
  });

  it("suppresses duplicate same-route updates while IPC is pending", async () => {
    let resolveSetProjectLastRoute: () => void = () => {};
    electronAPI.setProjectLastRoute.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSetProjectLastRoute = resolve;
      }),
    );
    useAppStore.setState({
      projects: new Map([["project-a", projectState()]]),
      activeProjectKey: "project-a",
      initializing: false,
    });

    const first = useAppStore
      .getState()
      .setProjectLastRoute("project-a", "/content?path=foo.md");
    const second = useAppStore
      .getState()
      .setProjectLastRoute("project-a", "/content?path=foo.md");

    expect(electronAPI.setProjectLastRoute).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().projects.get("project-a")?.lastRoute).toBe(
      "/content?path=foo.md",
    );

    resolveSetProjectLastRoute();
    await Promise.all([first, second]);
  });

  it("persists the global side panel pinned preference in localStorage", () => {
    expect(useAppStore.getState().sidePanelPinned).toBe(true);

    useAppStore.getState().setSidePanelPinned(false);

    expect(useAppStore.getState().sidePanelPinned).toBe(false);
    expect(localStorage.getItem("spherse:side-panel:pinned")).toBe("false");
  });

  it("coordinates side panel hover visibility at app level", () => {
    vi.useFakeTimers();
    useAppStore.getState().setSidePanelPinned(false);

    useAppStore.getState().showSidePanel();

    expect(useAppStore.getState().sidePanelHovered).toBe(true);

    useAppStore.getState().hideSidePanel();
    vi.advanceTimersByTime(119);
    expect(useAppStore.getState().sidePanelHovered).toBe(true);

    vi.advanceTimersByTime(1);
    expect(useAppStore.getState().sidePanelHovered).toBe(false);
    vi.useRealTimers();
  });

});
