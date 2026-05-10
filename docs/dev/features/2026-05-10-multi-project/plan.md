# Multi-Project Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-project support with an Activity Bar for switching, project persistence across restarts, and multi-server management.

**Architecture:** Add a 56px Activity Bar on the far left with project avatars. Electron main process manages multiple Fastify servers via a Map. Project list is persisted in electron-store. Frontend manages a `Map<string, ProjectState>` in App.tsx.

**Tech Stack:** Electron, React, Fastify, electron-store, Tailwind CSS v4

**Spec:** `docs/dev/features/2026-05-10-multi-project/design.md`

---

## File Map

### Electron layer
| File | Action | Responsibility |
|------|--------|---------------|
| `packages/app/electron/server.ts` | Rewrite | Multi-server Map: `startServer`, `stopServer`, `getServerPort`, `stopAllServers` |
| `packages/app/electron/settings.ts` | Extend | Open projects CRUD, last active project get/set |
| `packages/app/electron/ipc/project.ts` | Extend | New IPC handlers: `restore-projects`, `close-project`, `reveal-in-finder` |
| `packages/app/electron/preload.ts` | Extend | Expose new IPC methods |
| `packages/app/electron/main.ts` | Modify | `before-quit` cleanup |

### Frontend
| File | Action | Responsibility |
|------|--------|---------------|
| `packages/app/src/App.tsx` | Rewrite | Multi-project state, render Activity Bar + workspace |
| `packages/app/src/pages/HomePage.tsx` | Delete | Replaced by EmptyState + ProjectBar |
| `packages/app/src/pages/ProjectPage.tsx` | Minor | No changes needed (key prop set in App.tsx) |
| `packages/app/src/components/ProjectBar.tsx` | Create | Activity Bar with avatar list and + button |
| `packages/app/src/components/ProjectAvatar.tsx` | Create | Avatar with color gen, tooltip, right-click menu |
| `packages/app/src/components/EmptyState.tsx` | Create | Empty state when no project active |

### No changes to core or server packages.

---

## Task 1: Electron — Multi-server Manager

**Files:**
- Rewrite: `packages/app/electron/server.ts`

Rewrite `server.ts` to manage multiple Fastify instances. Key interface:

```ts
const servers = new Map<string, { server: FastifyInstance; port: number }>();

export async function startServer(projectRoot: string): Promise<number>
export function stopServer(projectRoot: string): void
export function getServerPort(projectRoot: string): number | undefined
export async function stopAllServers(): Promise<void>
```

- `startServer`: if project already has a running server, return existing port. Otherwise create new server and store in map.
- `stopServer`: close the Fastify instance for the given path, remove from map.
- `stopAllServers`: iterate and close all. Used on app quit.

- [ ] Rewrite `server.ts` with multi-server Map
- [ ] Verify existing `start-server` IPC still works (backward compatible — same signature)

---

## Task 2: Electron — Open Projects Persistence

**Files:**
- Extend: `packages/app/electron/settings.ts`

Add to the existing electron-store instance. Functions to add:

```ts
interface OpenProjectEntry {
  path: string;
  name: string;
  lastOpened: string;
}

getOpenProjects(): OpenProjectEntry[]
addOpenProject(projectPath: string): void      // name = path.basename, deduplicate by path
removeOpenProject(projectPath: string): void
updateLastOpened(projectPath: string): void
getLastActiveProject(): string | null
setLastActiveProject(path: string | null): void
```

Store keys: `"openProjects"` (array) and `"lastActiveProject"` (string | null).

- [ ] Add all CRUD functions to `settings.ts`
- [ ] Commit: `feat(electron): add open projects persistence to settings store`

---

## Task 3: Electron — New IPC Handlers

**Files:**
- Extend: `packages/app/electron/ipc/project.ts`
- Extend: `packages/app/electron/preload.ts`
- Modify: `packages/app/electron/main.ts`

### IPC: `restore-projects`

```ts
ipcMain.handle("restore-projects", async () => {
  const entries = getOpenProjects();
  const results: Array<{ path: string; name: string; port: number }> = [];
  for (const entry of entries) {
    if (!getServerPort(entry.path)) {
      try {
        const port = await startServer(entry.path);
        results.push({ path: entry.path, name: entry.name, port });
      } catch (err) {
        // If server fails to start (e.g. directory deleted), skip silently
      }
    } else {
      results.push({ path: entry.path, name: entry.name, port: getServerPort(entry.path)! });
    }
  }
  return results;
});
```

### IPC: `close-project`

```ts
ipcMain.handle("close-project", async (_event, projectPath: string) => {
  stopServer(projectPath);
  removeOpenProject(projectPath);
});
```

### IPC: `reveal-in-finder`

```ts
ipcMain.handle("reveal-in-finder", async (_event, projectPath: string) => {
  shell.showItemInFolder(projectPath);
});
```

### Preload additions

```ts
restoreProjects: () => ipcRenderer.invoke("restore-projects"),
closeProject: (projectRoot: string) => ipcRenderer.invoke("close-project", projectRoot),
revealInFinder: (projectRoot: string) => ipcRenderer.invoke("reveal-in-finder", projectRoot),
```

### Main.ts: cleanup on quit

```ts
app.on("before-quit", () => { stopAllServers(); });
```

- [ ] Add `restore-projects`, `close-project`, `reveal-in-finder` IPC handlers
- [ ] Update preload.ts with new methods
- [ ] Add `before-quit` handler in main.ts
- [ ] Commit: `feat(electron): add multi-project IPC handlers`

---

## Task 4: Frontend — Utility & Types

**Files:**
- Create: `packages/app/src/lib/avatar-color.ts`

Single utility for deterministic avatar color from project path:

```ts
export function getAvatarColor(path: string): string
// Returns "hsl(H, S%, L%)" where:
//   H = hash(path) % 360
//   S = 45–55% (hash-derived)
//   L = 68–75% (hash-derived)
```

Implementation: simple string hash (e.g. sum char codes with prime multiplier), derive hue and constrained sat/lightness from hash bits.

- [ ] Create `avatar-color.ts`
- [ ] Commit: `feat(frontend): add avatar color utility`

---

## Task 5: Frontend — EmptyState Component

**Files:**
- Create: `packages/app/src/components/EmptyState.tsx`

Simple centered component:

```
[Worldbuilding Agent title / logo]

点击左侧 + 打开项目
```

Use existing CSS variables (`--primary`, `--muted`). Centered flex layout, `h-full`.

- [ ] Create `EmptyState.tsx`
- [ ] Commit: `feat(frontend): add EmptyState component`

---

## Task 6: Frontend — ProjectAvatar Component

**Files:**
- Create: `packages/app/src/components/ProjectAvatar.tsx`

Props:
```ts
interface ProjectAvatarProps {
  name: string;
  path: string;
  active: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}
```

Render:
- 36x36 rounded square, bg from `getAvatarColor(path)`
- Centered text: first character of `name` (capitalize), color `var(--primary)`
- If `active`: 3px left border in `var(--accent)`, slight brightness boost
- Hover: subtle scale or brightness change
- `title` attribute shows full project name (native tooltip)

- [ ] Create `ProjectAvatar.tsx`
- [ ] Commit: `feat(frontend): add ProjectAvatar component`

---

## Task 7: Frontend — ProjectBar Component

**Files:**
- Create: `packages/app/src/components/ProjectBar.tsx`

Props:
```ts
interface ProjectBarProps {
  projects: Map<string, { name: string; path: string }>;
  activePath: string | null;
  onSelect: (path: string) => void;
  onAdd: () => void;
  onClose: (path: string) => void;
  onReveal: (path: string) => void;
}
```

Layout: 56px wide column, `bg-base`, `border-r`, `flex flex-col`.

Content:
- `flex-1 overflow-y-auto` area: map over projects, render `<ProjectAvatar>` for each
- `mt-auto`: `+` button (36x36 centered, dashed border `var(--border)`, `var(--muted)` text)

Right-click menu state managed here (same pattern as `ProjectPage.tsx` agent menu):
- Track `contextMenuPath: string | null`
- Render absolutely positioned menu with "关闭项目" and "在 Finder 中显示"
- Click-outside closes menu

- [ ] Create `ProjectBar.tsx`
- [ ] Commit: `feat(frontend): add ProjectBar component`

---

## Task 8: Frontend — Rewrite App.tsx

**Files:**
- Rewrite: `packages/app/src/App.tsx`
- Delete: `packages/app/src/pages/HomePage.tsx`

This is the main integration task. `App.tsx` becomes the multi-project orchestrator.

### State

```ts
interface ProjectState {
  name: string;
  port: number;
  ctx: AppContext;
}

const [projects, setProjects] = useState<Map<string, ProjectState>>(new Map());
const [activePath, setActivePath] = useState<string | null>(null);
const [initializing, setInitializing] = useState(true);
```

### Startup effect

```ts
useEffect(() => {
  (async () => {
    const restored = await window.electronAPI.restoreProjects();
    const map = new Map<string, ProjectState>();
    for (const { path, name, port } of restored) {
      map.set(path, { name, port, ctx: initAppContext(port, path) });
    }
    setProjects(map);
    // set activePath to last active (from IPC or first item)
    setInitializing(false);
  })();
}, []);
```

### Adding a project

```ts
const handleAddProject = async () => {
  const dir = await window.electronAPI.selectDirectory();
  if (!dir) return;
  if (projects.has(dir)) { setActivePath(dir); return; }  // already open, just switch
  const port = await window.electronAPI.startServer(dir);
  const name = dir.split("/").pop() || dir;
  setProjects(prev => new Map(prev).set(dir, { name, port, ctx: initAppContext(port, dir) }));
  setActivePath(dir);
};
```

### Closing a project

```ts
const handleCloseProject = async (path: string) => {
  await window.electronAPI.closeProject(path);
  let switched = false;
  setProjects(prev => {
    const next = new Map(prev);
    next.delete(path);
    if (activePath === path) {
      const remaining = [...next.keys()];
      setActivePath(remaining.length > 0 ? remaining[remaining.length - 1] : null);
      switched = true;
    }
    return next;
  });
};
```

### Reveal in Finder

```ts
const handleReveal = (path: string) => {
  window.electronAPI.revealInFinder(path);
};
```

### Render

```tsx
if (initializing) return <div className="flex items-center justify-center h-screen bg-base">...</div>;

return (
  <div className="flex h-screen">
    <ProjectBar
      projects={projects}
      activePath={activePath}
      onSelect={setActivePath}
      onAdd={handleAddProject}
      onClose={handleCloseProject}
      onReveal={handleReveal}
    />
    {activePath && projects.has(activePath) ? (
      <ProjectPage key={activePath} ctx={projects.get(activePath)!.ctx} />
    ) : (
      <EmptyState />
    )}
  </div>
);
```

### Delete HomePage.tsx

Remove `pages/HomePage.tsx` — its directory selection logic is now in `handleAddProject`.

- [ ] Rewrite `App.tsx` with multi-project state management
- [ ] Delete `HomePage.tsx`
- [ ] Commit: `feat(frontend): integrate multi-project support in App`

---

## Task 9: Update lastActiveProject on switch

**Files:**
- Modify: `packages/app/src/App.tsx` (small addition)

After `setActivePath`, also call IPC to persist `lastActiveProject`:

```ts
useEffect(() => {
  if (activePath) {
    window.electronAPI.setLastActiveProject?.(activePath);
  }
}, [activePath]);
```

This requires adding `setLastActiveProject` to preload:

```ts
// preload.ts
setLastActiveProject: (path: string) => ipcRenderer.invoke("set-last-active-project", path),
```

And corresponding IPC handler in `project.ts`:

```ts
ipcMain.handle("set-last-active-project", (_event, path: string) => {
  setLastActiveProject(path);
});
```

Also in the restore flow (Task 8), resolve last active:

```ts
const lastActive = await window.electronAPI.getLastActiveProject?.();
setActivePath(lastActive && map.has(lastActive) ? lastActive : (restored.length > 0 ? restored[0].path : null));
```

Requires `getLastActiveProject` IPC + preload as well.

- [ ] Add `set-last-active-project` and `get-last-active-project` IPC handlers
- [ ] Add to preload
- [ ] Wire into App.tsx activePath effect and restore flow
- [ ] Commit: `feat: persist last active project across sessions`

---

## Task 10: Manual Smoke Test

- [ ] `npm run build` compiles without errors
- [ ] `npm run dev` launches app
- [ ] Click + → select directory → project opens in workspace
- [ ] Click + → select another directory → second project avatar appears
- [ ] Click avatar to switch — workspace updates, agents/sessions reload
- [ ] Close app, reopen → both projects restored, last active selected
- [ ] Right-click avatar → "关闭项目" removes it
- [ ] Right-click avatar → "在 Finder 中显示" opens Finder
- [ ] Close all projects → empty state shown
- [ ] Final commit: `chore: update backlog with single-server refactor note`

---

## Backlog Entry

Add to `docs/dev/backlog.md`:

- **单服务器多引擎重构**: 将多 Fastify 实例合并为单实例多 engine，通过 URL 前缀区分项目，减少资源占用。参见 `docs/dev/features/2026-05-10-multi-project/design.md` Out of Scope 部分。
