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
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(globalThis, "window", {
      value: { electronAPI },
      configurable: true,
    });
    useAppStore.setState({
      projects: new Map(),
      activeProjectKey: null,
      initializing: true,
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
});
