# Floating Content Browser

## Summary

Allow users to open any file from the file tree in a floating overlay window that shows only the file body (no content-browser toolbar: no back button, no edit toggle, no html preview/source switch). HTML files render as a live preview (iframe), never source. Multiple files can be open simultaneously across separate floating windows, each draggable and resizable. Mirrors the existing floating-chat architecture.

## Requirements

1. Right-click a **file** (not directory) in the file tree shows a "浮窗" (Float) menu option; clicking it opens that file in a floating window.
2. If the file is already open in a floating window, the menu item becomes "取消浮窗" (Cancel Float); clicking it closes that file's window.
3. **Multi-window**: multiple files can be floated at once, each in its own window. One window per file is structurally enforced (no duplicates of the same file).
4. New windows are cascade-positioned (stair-step offset) so they don't fully overlap. No hard upper limit on window count.
5. The floating window shows the file body only, reusing `ContentView`. HTML always renders as preview (`<iframe>`), markdown/images/plain-text render read-only. No edit, no header, no view-mode toggle.
6. Windows auto-refresh when the underlying file changes on disk (consistent with the main content browser).
7. A window auto-closes when its file is deleted or can no longer be loaded.
8. Feature is Electron-only (same host matrix as `floating-chat`). On web the menu item is hidden.
9. Floating state (which files are open + their position/size) persists across app restarts.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Window type | CSS overlay portal to `document.body` | Same as floating-chat; escapes host `backdrop-filter`/`transform` containing blocks per AGENTS.md |
| Frame chrome | Extract shared `FloatingFrame` from `floating-chat` | `use-drag`/`use-resize` are host-agnostic; avoids duplication; future floats reuse for free. Behavior-preserving for floating-chat (`data-chat-float-*` retained via `hookPrefix`) |
| Multi-window store | `byProject: Record<projectId, Record<filePath, Window>>` | Keyed by filePath → structurally enforces one-window-per-file; cheap "is floated?" lookup for menu toggle |
| Body rendering | Reuse `ContentView` as-is with fixed read-only props | Already handles md/html-preview/image/plain-text; lives inside `<ProjectProvider>` so its context deps resolve |
| Decoupling | Export read-only selector hook `useFloatedFilePaths` + ui-sdk actions | Mirrors `useFloatingSessionId` + `dispatchAction("floatSession")` pattern; panels never import the feature-local store |
| Feature gate | `ELECTRON_ONLY`, `floating-content-browser` | Consistent platform story with floating-chat |
| Persistence | Single key `spherse:floating-content-browser` hydrated on creation | Fixes floating-chat's latent no-hydrate gap; trivial single read on load |
| Positioning | Cascade: `(count % 8) * 28px` offset from bottom-right default | Stair-steps without flying off-screen |

## Architecture

### Shared Floating Frame Extraction

Move `floating-chat`'s frame chrome into a generic, reusable component so both features share drag/resize logic.

```
components/floating-frame/
  FloatingFrame.tsx   # generic chrome: titlebar, close btn, 8 resize handles
  use-drag.ts         # moved from floating-chat (unchanged logic)
  use-resize.ts       # moved from floating-chat (unchanged logic)
  defaults.ts         # FLOAT_MIN_WIDTH/HEIGHT + getDefaultPosition(width, height)
```

**`FloatingFrame`** props:

```typescript
interface FloatingFrameProps {
  hookPrefix: string;            // "chat" | "content" → data-{prefix}-float-root etc.
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionCommit: (pos: { x: number; y: number }) => void;
  onSizeCommit: (size: { width: number; height: number }, pos: { x: number; y: number }) => void;
  onClose: () => void;
  onExpand?: () => void;         // optional double-click behavior (chat uses it; content omits)
  children: ReactNode;
}
```

- Generates `data-${hookPrefix}-float-root` / `-titlebar` / `-close` attributes.
- `position: fixed` + inline `left/top/width/height` (no transform — avoids containing-block issues).
- z-index varies with side-panel pinned state (reads `useSidePanelStore`), same as current `FloatingChatFrame`.
- `floating-chat` passes `hookPrefix="chat"` and `onExpand`; `floating-content-browser` passes `hookPrefix="content"` and omits `onExpand`.

**`floating-chat` refactor** (behavior-preserving):
- Delete `FloatingChatFrame.tsx`, `use-drag.ts`, `use-resize.ts`.
- `FloatingChatContainer` imports shared `FloatingFrame`, passes `hookPrefix="chat"`.
- `defaults.ts` keeps chat-specific `getDefaultFloatingState` (imports min sizes from shared defaults).
- `data-chat-float-*` attributes are unchanged → existing user themes keep working.

### State Management

New feature-local Zustand store `features/floating-content-browser/store.ts`:

```typescript
interface FloatingContentWindow {
  filePath: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface FloatingContentBrowserStore {
  byProject: Record<string, Record<string, FloatingContentWindow>>;
  openFloat: (projectId: string, filePath: string) => void;   // cascade-positioned; no-op if exists
  closeFloat: (projectId: string, filePath: string) => void;
  setPosition: (projectId: string, filePath: string, pos: { x: number; y: number }) => void;
  setSize: (projectId: string, filePath: string, size: { width: number; height: number }, pos: { x: number; y: number }) => void;
  clearProject: (projectId: string) => void;
}
```

- **`openFloat`**: if `byProject[projectId][filePath]` exists → no-op. Otherwise compute cascade position from current window count and insert.
- **Persistence**: single key `spherse:floating-content-browser` storing the whole `byProject` blob. Hydrated on store creation (read once). Write-through on every mutation.
- **Cascade**: `offset = (existingCount % 8) * 28`; `x = innerWidth - defaultWidth - MARGIN - offset`, `y = innerHeight - defaultHeight - MARGIN - offset`.

### Component Hierarchy

```
ProjectScope
├── <Outlet /> (main content)
├── <FloatingChatManager />           (existing)
└── <FeatureGate feature="floating-content-browser">
    └── <FloatingContentBrowserManager />
        └── for each window in byProject[projectId]:
            createPortal(document.body)
              └── FloatingContentBrowserContainer
                    ├── FloatingFrame (hookPrefix="content")
                    │   ├── TitleBar (filename + close)
                    │   └── ContentView  (reused, read-only)
                    └── useContentFile + useContentAutoRefresh
```

**`FloatingContentBrowserManager`**:
- Reads `byProject[projectId]` from store.
- Renders one `FloatingContentBrowserContainer` per open window.
- Each container self-manages its lifecycle: when its content fetch returns null (file deleted/missing), it calls `closeFloat` (mirrors `FloatingChatManager` session-disappear auto-clear).

**`FloatingContentBrowserContainer`**:
- `createPortal(..., document.body)`.
- Computes file-type flags (markdown/html/image) from extension, same logic as `content-browser/index.tsx`.
- Renders `FloatingFrame` with `hookPrefix="content"`, title = filename (basename of filePath).
- Body = `ContentView` with fixed read-only props: `htmlView="preview"`, `isEditing={false}`, `editedContent=""`.
- Fetches content via `useContentFile(client, filePath)`; live reload via `useContentAutoRefresh`.
- Commit handlers call `setPosition`/`setSize` on the store.

### Decoupling: Selector Hook + UI SDK Actions

Following the `floating-chat` pattern exactly:

- **Read** (consumed by panels): `useFloatedFilePaths(projectId): Set<string>` — thin selector hook exported from the feature (`features/floating-content-browser/use-floated-file-paths.ts`). Mirrors `useFloatingSessionId`.
- **Mutate** (consumed by panels via dispatch): ui-sdk actions `floatContent` / `unfloatContent`.

```typescript
// ui-sdk/handlers/float-content.ts
registerAction("floatContent", (params, ctx) => {
  const { path } = params as { path: string };
  if (!path) return;
  if (!isFeatureEnabled("floating-content-browser", ctx.hostKind)) {
    ctx.navigate(`/project/${ctx.projectId}/content?path=${encodeURIComponent(path)}`);
    return;
  }
  useFloatingContentBrowserStore.getState().openFloat(ctx.projectId, path);
});

// ui-sdk/handlers/unfloat-content.ts
registerAction("unfloatContent", (params, ctx) => {
  const { path } = params as { path: string };
  if (!path) return;
  useFloatingContentBrowserStore.getState().closeFloat(ctx.projectId, path);
});
```

### File-Tree Context Menu Integration

`FileTree` (generic component) gains two optional props so it stays decoupled from the feature store:

```typescript
export interface FileTreeProps {
  // ...existing
  onFloatFile?: (filePath: string) => void;
  floatedFilePaths?: Set<string>;
}
```

- Plumbed through `file-tree-context` → `FileTreeNode` → `FileTreeContextMenu`.
- Menu item rendered only when `onFloatFile` is provided **and** `node.type === "file"`, placed after "Copy Path":

```tsx
{onFloatFile && node.type === "file" && (
  <>
    <ContextMenuItem onClick={() => onFloatFile(node.path)}>
      <PictureInPicture2Icon className="size-4" />
      {floatedFilePaths?.has(node.path) ? t("file-tree.cancelFloat") : t("file-tree.float")}
    </ContextMenuItem>
    <ContextMenuSeparator />
  </>
)}
```

**Consuming panel** (`user-file-panel`; `skill-panel` does not wire float) wires it:

```tsx
const floatEnabled = useFeature("floating-content-browser");
const floatedFilePaths = useFloatedFilePaths(projectId);
<FileTree
  ...
  floatedFilePaths={floatEnabled ? floatedFilePaths : undefined}
  onFloatFile={floatEnabled ? (path) => {
    if (floatedFilePaths.has(path)) dispatchAction("unfloatContent", { path }, ctx);
    else dispatchAction("floatContent", { path }, ctx);
  } : undefined}
/>
```

### Theme Integration

New customizable selectors (parallel to `data-chat-float-*`):

| Selector | Description |
|---|---|
| `[data-content-float-root]` | Floating content window outermost container |
| `[data-content-float-titlebar]` | Title bar (filename + close) |
| `[data-content-float-close]` | Close button |

- Update `packages/presets/skills/create-ui-theme/` to document the new selectors.
- Colors use global theme tokens only (not chat-theme variables), per AGENTS.md portal rule.

### Feature Gate, Mounting, Cleanup

- Register `"floating-content-browser": ELECTRON_ONLY` in `lib/feature-registry.ts`.
- Mount in `layouts/ProjectScope.tsx` next to `<FloatingChatManager />`.
- Wire `clearFloatingContentBrowser(projectId)` into `use-project-actions.ts` `handleCloseProject`.

### i18n

Add to `file-tree` namespace (zh-CN baseline with UI-context comments, plus zh-TW + en):

- `file-tree.float` — "浮窗" (file-tree right-click menu: open this file in a floating window)
- `file-tree.cancelFloat` — "取消浮窗" (file-tree right-click menu: close this file's floating window)

## Files to Modify

| File | Change |
|---|---|
| `packages/app/src/features/floating-chat/FloatingChatContainer.tsx` | Import shared `FloatingFrame`, pass `hookPrefix="chat"` |
| `packages/app/src/components/file-tree/index.tsx` | Add `onFloatFile`/`floatedFilePaths` props, plumb into context |
| `packages/app/src/components/file-tree/file-tree-context.tsx` | Add fields to context value |
| `packages/app/src/components/file-tree/FileTreeNode.tsx` | Pass new props to menu |
| `packages/app/src/components/file-tree/FileTreeContextMenu.tsx` | Render conditional float menu item |
| `packages/app/src/features/user-file-panel/index.tsx` | Wire selector hook + dispatch |
| `packages/app/src/lib/feature-registry.ts` | Add `floating-content-browser` |
| `packages/app/src/layouts/ProjectScope.tsx` | Mount `FloatingContentBrowserManager` under `FeatureGate` |
| `packages/app/src/features/activity-bar/use-project-actions.ts` | Call `clearFloatingContentBrowser` on project close |
| `packages/app/src/ui-sdk/index.ts` | Import new handler files |
| `packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts` | Add `file-tree.float` / `file-tree.cancelFloat` |
| `packages/presets/skills/create-ui-theme/` | Document `data-content-float-*` selectors |

## New Files

| File | Purpose |
|---|---|
| `packages/app/src/components/floating-frame/FloatingFrame.tsx` | Generic draggable/resizable chrome |
| `packages/app/src/components/floating-frame/use-drag.ts` | Moved from floating-chat |
| `packages/app/src/components/floating-frame/use-resize.ts` | Moved from floating-chat |
| `packages/app/src/components/floating-frame/defaults.ts` | Shared min-size + default position |
| `packages/app/src/features/floating-content-browser/store.ts` | Multi-window Zustand store |
| `packages/app/src/features/floating-content-browser/defaults.ts` | Default size + cascade positioning |
| `packages/app/src/features/floating-content-browser/FloatingContentBrowserManager.tsx` | Renders containers per window |
| `packages/app/src/features/floating-content-browser/FloatingContentBrowserContainer.tsx` | Portal + frame + ContentView body |
| `packages/app/src/features/floating-content-browser/use-floated-file-paths.ts` | Read-only selector hook |
| `packages/app/src/features/floating-content-browser/index.ts` | Barrel exports |
| `packages/app/src/ui-sdk/handlers/float-content.ts` | `floatContent` action |
| `packages/app/src/ui-sdk/handlers/unfloat-content.ts` | `unfloatContent` action |

## Deleted Files

| File | Reason |
|---|---|
| `packages/app/src/features/floating-chat/FloatingChatFrame.tsx` | Replaced by shared `FloatingFrame` |
| `packages/app/src/features/floating-chat/use-drag.ts` | Moved to `components/floating-frame/` |
| `packages/app/src/features/floating-chat/use-resize.ts` | Moved to `components/floating-frame/` |

## Testing

- `store.test.ts` — open/close/setPosition/setSize/clearProject, cascade offset math, persistence hydrate round-trip, one-window-per-file enforcement.
- Existing `floating-chat` unit tests + E2E confirm the extraction refactor is behavior-preserving.
- E2E (desktop): open float from file-tree context menu, toggle label, drag/resize, multi-window cascade, file-deletion auto-close, project-close cleanup.

## Out of Scope

- "Expand to full content browser" action on the floating window (double-click does nothing; no expand button).
- Floating windows for directories.
- Web (non-Electron) support beyond the navigate-to-content-route fallback.
- Z-order/focus management between multiple floating windows (new windows simply render on top via cascade; explicit focus stealing is out of scope).
