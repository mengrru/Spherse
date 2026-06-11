# Floating Chat Window

## Summary

Allow users to detach a chat session into a floating overlay within the main application window. The floating chat is non-modal, draggable, resizable, and fully customizable via agent theme. Only one floating chat can exist at a time. Floating state persists across app restarts.

## Requirements

1. Right-click a session item in the sidebar shows a "Float" / "Cancel Float" menu option
2. Only one floating chat at a time; opening a new one auto-closes the existing one
3. If the session being floated is currently open in the main chat page, close the chat page (navigate to `/project/:projectKey`)
4. Floating chat is non-modal — user can interact with the main window simultaneously
5. The floating chat is draggable and resizable (bottom-right resize handle only)
6. Users can customize the entire floating window appearance via agent theme CSS
7. Floating state (session, position, size) persists to disk and restores on app restart
8. Main window and floating chat operate independently — clicking a different session in the sidebar opens it in the main window, leaving the floating chat unaffected

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Window type | CSS overlay (not separate BrowserWindow) | Simpler implementation, no IPC complexity, stays within single-window architecture |
| State location | `ProjectState.floatingChat` in `app-store` | Natural cleanup when project is closed (removing from Map discards state) |
| Rendering | React Portal to `document.body` | Rendering isolation, always on top of main content |
| Chat reuse | Reuse existing `Chat` component without modification | Minimize code duplication |
| Theme selectors | `data-chat-float-*` prefix | Consistent with existing `data-chat-*` naming convention |

## Architecture

### State Management

Add `floatingChat` field to `ProjectState` in `app-store`:

```typescript
interface FloatingChatState {
  sessionId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface ProjectState {
  // ...existing fields
  floatingChat?: FloatingChatState;
}
```

Store actions:

- `setFloatingChat(projectKey, state: FloatingChatState | null)` — set or clear floating chat. When setting, auto-replaces existing. When clearing, sets to `undefined`.
- Internally updates `ProjectState.floatingChat` in the `projects` Map.
- Calls `window.electronAPI.setProjectFloatingChat(project.path, state)` to persist.

**Persistence via IPC** (mirrors `lastRoute` pattern):

- New IPC handler: `set-project-floating-chat` — persists `FloatingChatState | null` to disk per project path.
- `restoreProjects` returns include `floatingChat` field.
- When project is closed, removing from `projects` Map naturally discards the floating state. The persisted data is cleaned up by the main process's project close logic.

**Edge cases**:

- Persisted session deleted → `FloatingChatManager` detects session doesn't exist in `project-data-store.sessions` and auto-clears `floatingChat`.
- Viewport resize → if floating chat position is outside new viewport bounds, clamp to nearest valid position.

### Component Hierarchy

```
App.tsx
├── ActivityBar
├── <Outlet />                          ← main window content
│   └── ProjectLayout
│       ├── ProjectPanel (sidebar)
│       └── Chat | ContentBrowser | WelcomePage
└── <FloatingChatManager />             ← always rendered at root level
    └── createPortal(document.body)
        └── FloatingChatContainer
            ├── FloatingChatFrame       ← draggable/resizable container
            │   ├── TitleBar            ← agent name + close button
            │   └── Chat                ← reused as-is
            └── <style>                 ← scoped agent theme CSS
```

**`FloatingChatManager`** (`packages/app/src/features/floating-chat/FloatingChatManager.tsx`):

- Rendered at root level in `App.tsx` (not inside router outlet).
- Reads `activeProjectKey` from `app-store`, then reads `floatingChat` from the active project's `ProjectState`.
- Reads `agents` and `sessions` from `project-data-store` to resolve the agent for the floating session.
- If `floatingChat` is null or the session no longer exists → renders nothing.
- Passes agent, sessionId, port, and onClose (calls `setFloatingChat(null)`) to `FloatingChatContainer`.

**`FloatingChatContainer`** (`packages/app/src/features/floating-chat/FloatingChatContainer.tsx`):

- Handles agent theme injection (reuses `useAgentTheme` logic, scoped to `data-chat-float-root`).
- Renders `FloatingChatFrame` with position/size from state.
- Manages drag/resize state updates, calling `setFloatingChat` on position/size change (debounced during drag, committed on mouse up).

**`FloatingChatFrame`** (`packages/app/src/features/floating-chat/FloatingChatFrame.tsx`):

- `position: fixed` container with `z-50`.
- CSS attributes: `data-chat-float-root` on outermost div.
- TitleBar with `data-chat-float-titlebar`, contains agent name and close button.
- Right-bottom corner resize handle.
- Drag via TitleBar mousedown handler.
- Min size: 320×400.
- Default size: 420×600.
- Default position: viewport bottom-right (right: 20px, bottom: 20px).

### Right-Click Context Menu

Modify `SessionRow` context menu (`packages/app/src/features/agent-session-list/SessionRow.tsx`):

Existing menu: `Rename` | `Delete`

New conditional items:

- No active floating chat → show "Float" (icon: detach/window icon)
- This session is currently floating → show "Cancel Float"
- Different session is floating → show "Float" (clicking auto-closes current floating chat and opens new one)

**"Float" action flow**:

1. Call `setFloatingChat(projectKey, { sessionId, position: defaultPosition, size: defaultSize })`
2. If this session is currently open in main chat page (`selectedSession.id === sessionId`) → navigate to `/project/:projectKey`

**"Cancel Float" action flow**:

1. Call `setFloatingChat(projectKey, null)`

### Drag & Resize Implementation

**Drag** (TitleBar as handle):

```
mousedown on titlebar
  → record offset from mouse to container top-left
  → mousemove: update container position (clamped to viewport)
  → mouseup: commit final position to store
```

- During drag: update local React state for smooth rendering.
- On mouse up: commit to store → persist via IPC.
- Viewport clamp: position is always within `0 <= x <= viewport.width - container.width` and `0 <= y <= viewport.height - container.height`.

**Resize** (bottom-right handle):

```
mousedown on resize handle
  → record initial size and mouse position
  → mousemove: compute new size (min 320×400)
  → mouseup: commit final size to store
```

- Same pattern: local state during resize, commit on mouse up.

### Theme Integration

**New CSS selectors** available in agent theme CSS (`.spherse/agents/{slug}-{shortId}/theme.css`):

| Selector | Description |
|---|---|
| `[data-chat-float-root]` | Floating window outermost container. Controls border, border-radius, box-shadow, background, backdrop-filter, etc. |
| `[data-chat-float-titlebar]` | Title bar area. Controls background, font, text color, drag handle cursor. |
| `[data-chat-float-titlebar] button` | Close button. Controls icon, hover state, color. |

**How it works**:

- `FloatingChatContainer` fetches agent theme CSS via `GET /api/agents/:id/theme` (same endpoint as inline chat).
- Uses `scopeCss()` to scope selectors to `[data-chat-float-root]`.
- Injects as `<style>` within the portal root.
- Existing `[data-chat-root]` selectors in the same theme file work naturally because `data-chat-root` is a child of `data-chat-float-root`.
- Users write one theme.css that covers both inline and floating chat appearance.

**DOM structure for theming**:

```html
<div data-chat-float-root
     style="position:fixed; left:Xpx; top:Ypx; width:Wpx; height:Hpx; z-index:50">
  <div data-chat-float-titlebar>
    <span>Agent Name</span>
    <button aria-label="Close">✕</button>
  </div>
  <div data-chat-root>
    <!-- existing Chat component renders here unchanged -->
  </div>
</div>
```

**Skill docs update**: `packages/presets/skills/create-agent-chat-theme/SKILL.md` must document the new `data-chat-float-*` selectors and provide examples.

### WebSocket Handling

No special handling needed. The design guarantees that a floating session is never simultaneously rendered in the main window:

- If session is in main chat page when user clicks "Float" → main chat page closes first.
- Floating chat and main chat always display different sessions.

Therefore `useChatSession` works unchanged — each `Chat` instance manages its own WS connection by sessionId.

### UI SDK Integration

The UI SDK (`packages/app/src/ui-sdk/`) provides a unified action dispatch mechanism. Both iframe postMessage callers and internal React component code can trigger UI operations via `dispatchAction()`. Floating chat integrates with UI SDK in two ways:

**New actions: `floatSession` / `unfloatSession`**

Register two new handlers in `packages/app/src/ui-sdk/handlers/`:

```typescript
// handlers/float-session.ts
registerAction("floatSession", (params, ctx) => {
  const { sessionId } = params as { sessionId: string };
  if (!sessionId || typeof sessionId !== "string") return;
  // Call the same logic as the right-click "Float" menu:
  // setFloatingChat + close main chat page if this session is open
  useAppStore.getState().setFloatingChat(ctx.projectKey, {
    sessionId,
    position: defaultPosition,
    size: defaultSize,
  });
});

// handlers/unfloat-session.ts
registerAction("unfloatSession", (_params, ctx) => {
  const project = useAppStore.getState().projects.get(ctx.projectKey);
  if (!project?.floatingChat) return;
  useAppStore.getState().setFloatingChat(ctx.projectKey, null);
});
```

This allows iframes (e.g., agent-generated HtmlCards) and internal components to trigger floating/unfloating:

```javascript
// From iframe HTML
window.parent.postMessage({
  type: "spherse:action",
  action: "floatSession",
  params: { sessionId: "abc" }
}, "*");

// From internal React component
dispatchAction("floatSession", { sessionId: "abc" }, ctx);
```

**Extend existing actions with `float` parameter**

Add an optional `float` boolean parameter to `createSession` and `sendMessage` handlers:

- `createSession`: when `float: true`, after creating the session, set it as floating instead of navigating to the chat page.
- `sendMessage`: when `float: true`, if the session is not already floating, float it; then send the message. If already in main window, float it and navigate main window away from that chat page.

```typescript
// handlers/create-session.ts (modified)
registerAction("createSession", async (params, ctx) => {
  const { agentId, message, float } = params as {
    agentId: string; message?: string; float?: boolean;
  };
  // ... existing validation ...
  const session = await useProjectDataStore.getState()
    .createSession(ctx.projectKey, ctx.client, agentId, message);
  if (!session) return;

  if (float) {
    useAppStore.getState().setFloatingChat(ctx.projectKey, {
      sessionId: session.id,
      position: defaultPosition,
      size: defaultSize,
    });
  } else {
    ctx.navigate(`/project/${ctx.projectKey}/chat/${session.id}`);
  }
});
```

**Skill docs update**: `packages/presets/skills/use-ui-sdk/SKILL.md` must document the new `floatSession`, `unfloatSession` actions and the `float` parameter on `createSession` / `sendMessage`.

### i18n

New user-visible strings needed:

- "Float" — context menu item label
- "Cancel Float" — context menu item label

These should be migrated to `@spherse/i18n` per project conventions.

## Files to Modify

| File | Change |
|---|---|
| `packages/app/src/stores/app-store.ts` | Add `FloatingChatState` to `ProjectState`, add `setFloatingChat` action |
| `packages/app/electron/ipc/project.ts` | Add `set-project-floating-chat` IPC handler |
| `packages/app/electron/preload.ts` | Expose new IPC method |
| `packages/app/src/App.tsx` | Render `FloatingChatManager` |
| `packages/app/src/features/agent-session-list/SessionRow.tsx` | Add "Float" / "Cancel Float" to context menu |
| `packages/app/src/features/chat/index.tsx` | No changes (reused as-is) |
| `packages/app/src/ui-sdk/handlers/create-session.ts` | Add `float` parameter support |
| `packages/app/src/ui-sdk/handlers/send-message.ts` | Add `float` parameter support |
| `packages/app/src/ui-sdk/index.ts` | Import new handler files |
| `packages/presets/skills/create-agent-chat-theme/SKILL.md` | Document `data-chat-float-*` selectors |
| `packages/presets/skills/use-ui-sdk/SKILL.md` | Document `floatSession`, `unfloatSession` actions and `float` param |

## New Files

| File | Purpose |
|---|---|
| `packages/app/src/features/floating-chat/FloatingChatManager.tsx` | Root component, reads store, resolves agent data |
| `packages/app/src/features/floating-chat/FloatingChatContainer.tsx` | Theme injection, portal rendering |
| `packages/app/src/features/floating-chat/FloatingChatFrame.tsx` | Draggable/resizable frame, titlebar, resize handle |
| `packages/app/src/features/floating-chat/use-drag.ts` | Drag hook (mousedown/move/up) |
| `packages/app/src/features/floating-chat/use-resize.ts` | Resize hook (bottom-right handle) |
| `packages/app/src/ui-sdk/handlers/float-session.ts` | `floatSession` action handler |
| `packages/app/src/ui-sdk/handlers/unfloat-session.ts` | `unfloatSession` action handler |

## Out of Scope

- Multiple simultaneous floating windows
- Separate Electron BrowserWindow (OS-level floating)
- Floating chat for non-chat views (content browser, settings, etc.)
- Remembering floating chat across project close/reopen (state is discarded on project close)
- Keyboard shortcuts for floating/unfloating
