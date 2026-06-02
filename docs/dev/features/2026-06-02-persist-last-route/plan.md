# Persist Last Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each open project's last visited sub-route and restore it on app startup, project switch, and active project close.

**Architecture:** Extend the existing `electron-store` `openProjects` entries with `lastRoute`, pass it through the existing project IPC restore flow, cache it in `ProjectState`, and persist route changes from `ProjectLayout` after React Router location changes. `App.tsx` uses the cached `lastRoute` only for restore/navigation; project switch handlers do not explicitly save the current route.

**Tech Stack:** Electron main/preload IPC, React Router hash routes, Zustand, Vitest, TypeScript strict mode.

---

## Source Documents

- Design: `docs/dev/features/2026-06-02-persist-last-route/design.md`
- Existing route design: `docs/dev/features/2026-05-31-frontend-routing-state/design.md`

## File Structure

- Modify: `packages/app/electron/settings.ts`
  - Add `lastRoute?: string` to `OpenProjectEntry`.
  - Preserve existing `lastRoute` when updating an existing open project entry.
  - Add `updateProjectLastRoute(projectPath, route)`.
- Modify: `packages/app/electron/ipc/project.ts`
  - Return `lastRoute` from `restore-projects`.
  - Add `set-project-last-route` IPC handler.
- Modify: `packages/app/electron/preload.ts`
  - Expose `setProjectLastRoute(projectRoot, route)`.
- Modify: `packages/app/src/main.tsx`
  - Update `Window.electronAPI` types for `restoreProjects` and `setProjectLastRoute`.
- Modify: `packages/app/src/stores/app-store.ts`
  - Add `lastRoute?: string` to `ProjectState`.
  - Add `setProjectLastRoute(projectKey, route)` action.
  - Fill `lastRoute` during restore.
- Create: `packages/app/src/stores/app-store.test.ts`
  - Verify restored `lastRoute` is cached.
  - Verify `setProjectLastRoute` persists through IPC and updates store state.
- Modify: `packages/app/src/layouts/ProjectLayout.tsx`
  - Persist the current project's sub-route from a `location` effect.
- Modify: `packages/app/src/App.tsx`
  - Restore startup, project switch, project open existing, and project close navigation with cached `lastRoute`.

Do not commit during implementation unless the user explicitly asks. The repository instruction says code completion should wait for a manual commit request.

---

### Task 1: Add Store-Level Failing Tests

**Files:**
- Create: `packages/app/src/stores/app-store.test.ts`

- [ ] **Step 1: Write the failing store tests**

Create `packages/app/src/stores/app-store.test.ts` with this content:

```ts
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
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test --workspace=packages/app -- app-store.test.ts
```

Expected: FAIL because `ProjectState.lastRoute`, `Window.electronAPI.setProjectLastRoute`, and `useAppStore.getState().setProjectLastRoute` do not exist yet.

---

### Task 2: Add Electron Settings and IPC Persistence

**Files:**
- Modify: `packages/app/electron/settings.ts`
- Modify: `packages/app/electron/ipc/project.ts`
- Modify: `packages/app/electron/preload.ts`
- Modify: `packages/app/src/main.tsx`

- [ ] **Step 1: Extend persisted open project entries**

In `packages/app/electron/settings.ts`, update `OpenProjectEntry`:

```ts
export interface OpenProjectEntry {
  path: string;
  name: string;
  lastOpened: string;
  lastRoute?: string;
}
```

- [ ] **Step 2: Preserve existing lastRoute in addOpenProject**

In `packages/app/electron/settings.ts`, replace the `entry` construction in `addOpenProject` with:

```ts
  const existing = idx >= 0 ? projects[idx] : undefined;
  const entry: OpenProjectEntry = {
    path: projectPath,
    name: path.basename(projectPath),
    lastOpened: new Date().toISOString(),
    lastRoute: existing?.lastRoute,
  };
```

Keep the existing `if (idx >= 0) { projects[idx] = entry; } else { projects.push(entry); }` block unchanged.

- [ ] **Step 3: Add route update helper**

In `packages/app/electron/settings.ts`, add this function after `updateLastOpened`:

```ts
export function updateProjectLastRoute(projectPath: string, route: string): void {
  const projects = getOpenProjects();
  const entry = projects.find((p) => p.path === projectPath);
  if (entry) {
    entry.lastRoute = route;
    settingsStore.set("openProjects", projects);
  }
}
```

- [ ] **Step 4: Wire IPC restore and setter**

In `packages/app/electron/ipc/project.ts`, update the settings import to include `updateProjectLastRoute`:

```ts
import {
  getOpenProjects,
  addOpenProject,
  removeOpenProject,
  setLastActiveProject,
  getLastActiveProject,
  updateProjectLastRoute,
} from "../settings.js";
```

In the `restore-projects` handler, change the `results` type to:

```ts
    const results: Array<{ path: string; name: string; port: number; lastRoute?: string }> = [];
```

Change both `results.push` calls to include `lastRoute: entry.lastRoute`:

```ts
          results.push({ path: entry.path, name: entry.name, port, lastRoute: entry.lastRoute });
```

```ts
        results.push({
          path: entry.path,
          name: entry.name,
          port: getServerPort(entry.path)!,
          lastRoute: entry.lastRoute,
        });
```

Add this IPC handler after `get-last-active-project`:

```ts
  ipcMain.handle("set-project-last-route", (_event, projectPath: string, route: string) => {
    updateProjectLastRoute(projectPath, route);
  });
```

- [ ] **Step 5: Expose preload API**

In `packages/app/electron/preload.ts`, add this method inside `contextBridge.exposeInMainWorld("electronAPI", { ... })`:

```ts
  setProjectLastRoute: (projectRoot: string, route: string) =>
    ipcRenderer.invoke("set-project-last-route", projectRoot, route),
```

- [ ] **Step 6: Update renderer API types**

In `packages/app/src/main.tsx`, change `restoreProjects` and add `setProjectLastRoute`:

```ts
      restoreProjects: () => Promise<Array<{ path: string; name: string; port: number; lastRoute?: string }>>;
      addOpenProject: (projectRoot: string) => Promise<void>;
      closeProject: (projectRoot: string) => Promise<void>;
      revealInFinder: (projectRoot: string) => Promise<void>;
      setLastActiveProject: (path: string) => Promise<void>;
      getLastActiveProject: () => Promise<string | null>;
      setProjectLastRoute: (projectRoot: string, route: string) => Promise<void>;
```

- [ ] **Step 7: Run app build to check Electron/preload typing**

Run:

```bash
npm run build --workspace=packages/app
```

Expected: FAIL until Task 3 updates `app-store.ts`; if the only errors are from missing `ProjectState.lastRoute` or `setProjectLastRoute`, continue to Task 3.

---

### Task 3: Cache lastRoute in App Store

**Files:**
- Modify: `packages/app/src/stores/app-store.ts`
- Test: `packages/app/src/stores/app-store.test.ts`

- [ ] **Step 1: Extend ProjectState and AppStore**

In `packages/app/src/stores/app-store.ts`, update `ProjectState`:

```ts
export interface ProjectState {
  key: string;
  path: string;
  name: string;
  port: number;
  ctx: AppContext;
  lastRoute?: string;
}
```

Update `AppStore`:

```ts
interface AppStore {
  projects: Map<string, ProjectState>;
  activeProjectKey: string | null;
  initializing: boolean;
  restoreProjects: () => Promise<string | null>;
  openProject: () => Promise<string | null>;
  closeProject: (projectKey: string) => Promise<string | null>;
  revealProject: (projectKey: string) => Promise<void>;
  setActiveProject: (projectKey: string | null) => Promise<void>;
  setProjectLastRoute: (projectKey: string, route: string) => Promise<void>;
}
```

- [ ] **Step 2: Store lastRoute during restore**

In `restoreProjects`, change the loop header and project creation to:

```ts
    for (const { path, name, port, lastRoute } of restored) {
      const key = createProjectKey(path, projects.keys());
      projects.set(key, {
        key,
        path,
        name,
        port,
        ctx: initAppContext(port, path),
        lastRoute,
      });
    }
```

- [ ] **Step 3: Add setProjectLastRoute action**

In the Zustand store object, add this action after `setActiveProject`:

```ts
  async setProjectLastRoute(projectKey, route) {
    const project = get().projects.get(projectKey);
    if (!project || project.lastRoute === route) return;

    await window.electronAPI.setProjectLastRoute(project.path, route);

    set((state) => {
      const current = state.projects.get(projectKey);
      if (!current) return {};
      const projects = new Map(state.projects);
      projects.set(projectKey, { ...current, lastRoute: route });
      return { projects };
    });
  },
```

If this is appended after `setActiveProject`, add a comma after the `setActiveProject` method block.

- [ ] **Step 4: Run the store test**

Run:

```bash
npm test --workspace=packages/app -- app-store.test.ts
```

Expected: PASS.

---

### Task 4: Persist Route Changes from ProjectLayout

**Files:**
- Modify: `packages/app/src/layouts/ProjectLayout.tsx`

- [ ] **Step 1: Read action from store**

In `ProjectLayout`, add the selector near `setActiveProject`:

```ts
  const setProjectLastRoute = useAppStore((state) => state.setProjectLastRoute);
```

- [ ] **Step 2: Add route persistence effect**

After the existing effect that calls `setActiveProject(projectKey)`, add:

```ts
  useEffect(() => {
    const fullPath = location.pathname + location.search;
    const prefix = `/project/${projectKey}`;
    const subRoute = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : "";
    void setProjectLastRoute(projectKey, subRoute);
  }, [location.pathname, location.search, projectKey, setProjectLastRoute]);
```

This effect is the only save path for route persistence. Do not add route saving to `handleSelectProject`, `handleCloseProject`, or `setActiveProject`.

- [ ] **Step 3: Run app tests**

Run:

```bash
npm test --workspace=packages/app
```

Expected: PASS.

---

### Task 5: Restore lastRoute During Navigation

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Add route builder helper**

In `packages/app/src/App.tsx`, add this helper above `export function App()`:

```ts
function buildProjectRoute(projectKey: string, lastRoute?: string): string {
  const suffix = lastRoute?.startsWith("/") ? lastRoute : "";
  return `/project/${projectKey}${suffix}`;
}
```

- [ ] **Step 2: Restore lastRoute on startup**

Replace the startup navigation line:

```ts
        navigate(`/project/${projectKey}`, { replace: true });
```

with:

```ts
        const project = useAppStore.getState().projects.get(projectKey);
        navigate(buildProjectRoute(projectKey, project?.lastRoute), { replace: true });
```

- [ ] **Step 3: Restore lastRoute when opening an already-open project**

Replace `handleAddProject` with:

```ts
  const handleAddProject = async () => {
    const projectKey = await openProject();
    if (projectKey) {
      const project = useAppStore.getState().projects.get(projectKey);
      navigate(buildProjectRoute(projectKey, project?.lastRoute));
    }
  };
```

For a newly opened project `lastRoute` is absent, so this still navigates to `/project/:projectKey`.

- [ ] **Step 4: Restore lastRoute when selecting a project**

Replace `handleSelectProject` with:

```ts
  const handleSelectProject = async (projectKey: string) => {
    await setActiveProject(projectKey);
    const project = useAppStore.getState().projects.get(projectKey);
    navigate(buildProjectRoute(projectKey, project?.lastRoute));
  };
```

Do not add any save call here. Saving is handled by `ProjectLayout` location effect.

- [ ] **Step 5: Restore lastRoute after closing active project**

Replace the `if (nextProjectKey) { ... }` block in `handleCloseProject` with:

```ts
    if (nextProjectKey) {
      const project = useAppStore.getState().projects.get(nextProjectKey);
      navigate(buildProjectRoute(nextProjectKey, project?.lastRoute));
    } else {
      navigate("/");
    }
```

- [ ] **Step 6: Run app tests**

Run:

```bash
npm test --workspace=packages/app
```

Expected: PASS.

---

### Task 6: Final Verification

**Files:**
- Verify: all modified files

- [ ] **Step 1: Run the app package build**

Run:

```bash
npm run build --workspace=packages/app
```

Expected: PASS.

- [ ] **Step 2: Run all app tests**

Run:

```bash
npm test --workspace=packages/app
```

Expected: PASS.

- [ ] **Step 3: Inspect the diff**

Run:

```bash
git diff -- docs/dev/features/2026-06-02-persist-last-route/plan.md packages/app/electron/settings.ts packages/app/electron/ipc/project.ts packages/app/electron/preload.ts packages/app/src/main.tsx packages/app/src/stores/app-store.ts packages/app/src/stores/app-store.test.ts packages/app/src/layouts/ProjectLayout.tsx packages/app/src/App.tsx
```

Expected: Diff only contains the planned route persistence changes and the implementation plan.

- [ ] **Step 4: Manual validation checklist**

Run the app with:

```bash
npm run dev
```

Validate these behaviors manually:

- Open project A, navigate to a chat session, switch to project B, then switch back to A. Expected: A restores to that chat route.
- In project A, open a content route with a file path, quit the app, start it again. Expected: app starts on project A's content route.
- Open a project with no `lastRoute`. Expected: app navigates to `/project/:projectKey`.
- Close the active project while another project remains. Expected: the next active project opens at its cached `lastRoute`.

Do not commit unless the user explicitly requests it.

---

## Self-Review

### Spec Coverage

- Per-project route persistence: Task 2 adds `OpenProjectEntry.lastRoute`; Task 3 adds `ProjectState.lastRoute`; Task 4 saves route changes.
- Startup restore: Task 5 Step 2.
- Project switch restore: Task 5 Step 4.
- Project close restore: Task 5 Step 5.
- No extra save during project switch: Task 4 Step 2 and Task 5 Step 4 explicitly prohibit switch-handler saves.
- Existing route structure unchanged: no task modifies `packages/app/src/router.tsx`.
- Existing invalid session/file behavior unchanged: no task changes chat/content error handling.

### Placeholder Scan

- No placeholder markers or unspecified edge-handling steps remain.
- Every code-changing step includes the exact code to add or replace.
- Every verification step includes the exact command and expected result.

### Type Consistency

- `lastRoute?: string` is consistently used in `OpenProjectEntry`, `restoreProjects` return type, and `ProjectState`.
- IPC names are consistent: `set-project-last-route` in main/preload and `setProjectLastRoute` in renderer.
- Store action signature is consistent: `setProjectLastRoute(projectKey: string, route: string): Promise<void>`.
