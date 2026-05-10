# Multi-Project Support: Persistence & Switching

## Overview

Support opening multiple worldbuilding projects simultaneously, with a persistent project list in a new Activity Bar on the left side of the window. Users can switch between projects instantly and their open projects are restored on app restart.

## User Stories

1. User opens 2-3 projects, works on one, switches to another — all state preserved
2. User quits and reopens the app — all previously open projects are restored automatically
3. User right-clicks a project avatar to close it (remove from list, stop server)
4. First-time user opens the app, sees an empty state prompting to add a project

## Layout

```
+------------+------------------+----------------------------------------+
| Activity   | Workspace        | Main Content                           |
| Bar (56px) | Sidebar (240px)  | (flex-1)                              |
|            |                  |                                        |
| [项] ←active| [Agents]        | Chat / Content / Empty state           |
| [目]       | [Files]          |                                        |
| [首]       | [Settings]       |                                        |
| [字]       |                  |                                        |
|            |                  |                                        |
|  [+]       |                  |                                        |
+------------+------------------+----------------------------------------+
```

- Activity Bar: always visible, 56px wide, `bg-base` background
- Each project is a 36x36 square avatar with the project directory's first character
- Active project has a left border highlight (3px `bg-accent` left strip)
- `+` button at bottom opens directory picker
- When no project is open, workspace sidebar and main content show empty state

## Avatar Color Generation

Colors are deterministically generated from the project path (hash), within a constrained range:

- Hue: 0–360 (full range)
- Saturation: 40–60% (muted, not vivid)
- Lightness: 65–78% (light enough for dark text overlay)

The text on the avatar uses a dark color (`--primary`) for readability.

Color function: `hsl(hue, 45-55%, 68-75%)` where hue is derived from a simple hash of the project path.

## Project Persistence

### Storage (electron-store)

Add to the existing settings store (same `electron-store` instance, `name: "settings"`):

```ts
interface OpenProjectEntry {
  path: string;
  name: string;           // directory basename
  lastOpened: string;     // ISO 8601 timestamp
}
```

Keys:
- `openProjects: OpenProjectEntry[]` — list of open projects
- `lastActiveProject: string | null` — path of the last active project

### API (settings.ts)

```ts
getOpenProjects(): OpenProjectEntry[]
addOpenProject(path: string): void
removeOpenProject(path: string): void
updateLastOpened(path: string): void
getLastActiveProject(): string | null
setLastActiveProject(path: string | null): void
```

## Server Lifecycle (Electron main process)

### Multi-server manager

Replace the current single `server` variable with a `Map`:

```ts
// server.ts refactor
const servers = new Map<string, { server: FastifyInstance, port: number }>();

startServer(projectRoot: string): Promise<number>
stopServer(projectRoot: string): void
getServerPort(projectRoot: string): number | undefined
stopAllServers(): Promise<void>
```

### IPC additions

| Channel | Direction | Description |
|---------|-----------|-------------|
| `restore-projects` | renderer → main | Start servers for all persisted projects, return `[{ path, name, port }]` |
| `close-project` | renderer → main | Stop a project's server, remove from store |
| `get-open-projects` | renderer → main | Return open projects list |

### Preload additions

```ts
closeProject: (projectRoot: string) => ipcRenderer.invoke("close-project", projectRoot),
getOpenProjects: () => ipcRenderer.invoke("get-open-projects"),
restoreProjects: () => ipcRenderer.invoke("restore-projects"),
```

## Frontend State

### Types

```ts
interface ProjectState {
  path: string;
  name: string;
  port: number;
  ctx: AppContext;
  loading: boolean;
  error?: string;
}
```

### App-level state (App.tsx)

```ts
const [projects, setProjects] = useState<Map<string, ProjectState>>(new Map());
const [activePath, setActivePath] = useState<string | null>(null);
```

### Startup flow

1. App renders with empty project map
2. `useEffect` calls `window.electronAPI.restoreProjects()`
3. Electron main reads `openProjects` from store, starts a server for each
4. Returns `[{ path, name, port }]` to renderer
5. Renderer creates `ProjectState` for each, sets `activePath` to `lastActiveProject`
6. If no projects, shows empty state

### Project switching

`activePath` change causes workspace to re-render with the new project's `ctx`. `ProjectPage` receives `key={activePath}` to force re-mount on switch, resetting local state.

### Adding a project

1. User clicks `+` in Activity Bar
2. `selectDirectory()` IPC → directory picker
3. If directory already open, just switch to it (no duplicate)
4. `startServer(dir)` IPC → returns port
5. Renderer adds to `projects` map, sets as active
6. Electron main persists to `openProjects` in store

### Closing a project

1. User right-clicks avatar → context menu → "关闭项目"
2. `closeProject(path)` IPC
3. Electron main stops server, removes from store
4. Renderer removes from `projects` map
5. If it was active, switch to last opened project or empty state

## Right-click Context Menu

React component (consistent with existing `···` menus):

- **关闭项目** — stop server, remove from list
- Separator
- **在 Finder 中显示** — `shell.showItemInFolder(projectRoot)`

Requires new IPC channel `reveal-in-finder` and preload method.

## Empty State

When no project is active, the workspace area shows:

```
[Logo / Brand: "Worldbuilding Agent"]

点击左侧 + 打开项目
```

Workspace sidebar is hidden when no project is active.

## Data Flow

```
App.tsx
  │
  ├── ProjectBar          ← projects map, activePath, onAdd/onClose/onSelect
  │     ├── ProjectAvatar (× N)
  │     └── + button
  │
  └── {activePath ? (
        <ProjectPage key={activePath} ctx={projects.get(activePath).ctx} />
      ) : (
        <EmptyState />
      )}
```

## File Change Summary

### Electron layer
- `electron/server.ts` — refactor to multi-server Map, add `stopServer`, `getServerPort`, `stopAllServers`
- `electron/settings.ts` — add `openProjects` CRUD, `lastActiveProject` get/set
- `electron/ipc/project.ts` — add `restore-projects`, `close-project`, `reveal-in-finder` handlers
- `electron/preload.ts` — expose `restoreProjects`, `closeProject`, `revealInFinder`
- `electron/main.ts` — call `stopAllServers` on `before-quit`

### Frontend
- `App.tsx` — multi-project state management, render Activity Bar + workspace
- `pages/HomePage.tsx` — delete
- `pages/ProjectPage.tsx` — add `key` prop usage (no other changes)
- `components/ProjectBar.tsx` — new
- `components/ProjectAvatar.tsx` — new (color gen, tooltip, right-click menu)
- `components/EmptyState.tsx` — new

### Core layer
- No changes to `@worldbuilding-agent/core`

### Styles
- `styles.css` — no changes needed (uses existing CSS variables)

## Out of Scope (Backlog)

- Single-server multi-engine refactor
- Drag-to-reorder projects
- Project naming/renaming (uses directory name)
- Keyboard shortcuts for project switching
