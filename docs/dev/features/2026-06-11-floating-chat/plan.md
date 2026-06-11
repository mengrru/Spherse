# Floating Chat Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-modal floating overlay for chat sessions within the main app window, with drag/resize support, theme customization, and persistence.

**Architecture:** Floating state stored in `ProjectState.floatingChat` (app-store), rendered via React Portal at root level. The existing `Chat` component is reused as-is. New UI SDK actions (`floatSession`/`unfloatSession`) and extended existing actions (`createSession`/`sendMessage` with `float` param) allow programmatic control. Persistence follows the `lastRoute` IPC pattern.

**Tech Stack:** React, Zustand, Electron IPC, Tailwind CSS, @spherse/i18n

---

## File Structure

| Action | File | Responsibility |
|---|---|---|
| Create | `packages/app/src/features/floating-chat/index.ts` | Barrel export |
| Create | `packages/app/src/features/floating-chat/FloatingChatManager.tsx` | Root component, reads store, resolves agent/session |
| Create | `packages/app/src/features/floating-chat/FloatingChatContainer.tsx` | Portal rendering, theme injection |
| Create | `packages/app/src/features/floating-chat/FloatingChatFrame.tsx` | Draggable/resizable frame, titlebar |
| Create | `packages/app/src/features/floating-chat/use-drag.ts` | Drag hook |
| Create | `packages/app/src/features/floating-chat/use-resize.ts` | Resize hook |
| Create | `packages/app/src/features/floating-chat/defaults.ts` | Default position/size constants |
| Create | `packages/app/src/ui-sdk/handlers/float-session.ts` | `floatSession` action handler |
| Create | `packages/app/src/ui-sdk/handlers/unfloat-session.ts` | `unfloatSession` action handler |
| Modify | `packages/app/src/stores/app-store.ts` | Add `FloatingChatState` to `ProjectState`, add `setFloatingChat` action |
| Modify | `packages/app/electron/settings.ts` | Add `floatingChat` to `OpenProjectEntry`, add read/write helpers |
| Modify | `packages/app/electron/ipc/project.ts` | Add `set-project-floating-chat` IPC handler, extend `restore-projects` |
| Modify | `packages/app/electron/preload.ts` | Expose `setProjectFloatingChat` |
| Modify | `packages/app/src/App.tsx` | Render `FloatingChatManager` |
| Modify | `packages/app/src/features/agent-session-list/SessionRow.tsx` | Add "Float" / "Cancel Float" context menu items |
| Modify | `packages/app/src/ui-sdk/handlers/create-session.ts` | Add `float` param support |
| Modify | `packages/app/src/ui-sdk/handlers/send-message.ts` | Add `float` param support |
| Modify | `packages/app/src/ui-sdk/index.ts` | Import new handlers |
| Modify | `packages/i18n/src/locales/zh-CN.ts` | Add float/unfloat i18n keys |
| Modify | `packages/i18n/src/locales/zh-TW.ts` | Add float/unfloat i18n keys |
| Modify | `packages/i18n/src/locales/en.ts` | Add float/unfloat i18n keys |

---

### Task 1: State management — app-store & IPC persistence

**Files:**
- Modify: `packages/app/src/stores/app-store.ts`
- Modify: `packages/app/electron/settings.ts`
- Modify: `packages/app/electron/ipc/project.ts`
- Modify: `packages/app/electron/preload.ts`
- Create: `packages/app/src/features/floating-chat/defaults.ts`
- Test: `packages/app/src/stores/app-store.test.ts`

- [ ] **Step 1: Add `FloatingChatState` type and `setFloatingChat` action to app-store**

In `packages/app/src/stores/app-store.ts`, add the interface and store field/method:

```typescript
export interface FloatingChatState {
  sessionId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface ProjectState {
  key: string;
  path: string;
  name: string;
  port: number;
  ctx: AppContext;
  lastRoute?: string;
  floatingChat?: FloatingChatState;
}
```

Add to `AppStore` interface:

```typescript
interface AppStore {
  // ...existing
  setFloatingChat: (projectKey: string, state: FloatingChatState | null) => void;
}
```

Add implementation inside the store:

```typescript
setFloatingChat(projectKey, state) {
  set((s) => {
    const current = s.projects.get(projectKey);
    if (!current) return {};
    const projects = new Map(s.projects);
    if (state) {
      const { floatingChat: _, ...rest } = current;
      projects.set(projectKey, { ...rest, floatingChat: state });
    } else {
      const { floatingChat: _, ...rest } = current;
      projects.set(projectKey, rest);
    }
    return { projects };
  });
  const project = get().projects.get(projectKey);
  if (project) {
    void window.electronAPI.setProjectFloatingChat(project.path, state ?? null);
  }
},
```

Create `packages/app/src/features/floating-chat/defaults.ts`:

```typescript
import type { FloatingChatState } from "../../stores/app-store";

export const FLOAT_DEFAULT_WIDTH = 420;
export const FLOAT_DEFAULT_HEIGHT = 600;
export const FLOAT_MIN_WIDTH = 320;
export const FLOAT_MIN_HEIGHT = 400;
export const FLOAT_MARGIN = 20;

export function getDefaultFloatingState(sessionId: string): FloatingChatState {
  return {
    sessionId,
    position: {
      x: window.innerWidth - FLOAT_DEFAULT_WIDTH - FLOAT_MARGIN,
      y: window.innerHeight - FLOAT_DEFAULT_HEIGHT - FLOAT_MARGIN,
    },
    size: {
      width: FLOAT_DEFAULT_WIDTH,
      height: FLOAT_DEFAULT_HEIGHT,
    },
  };
}
```

- [ ] **Step 2: Add persistence in electron/settings.ts**

Add `floatingChat` field to `OpenProjectEntry`:

```typescript
export interface OpenProjectEntry {
  path: string;
  name: string;
  lastOpened: string;
  lastRoute?: string;
  floatingChat?: { sessionId: string; position: { x: number; y: number }; size: { width: number; height: number } } | null;
}
```

Add a new helper function:

```typescript
export function updateProjectFloatingChat(
  projectPath: string,
  floatingChat: OpenProjectEntry["floatingChat"],
): void {
  const projects = getOpenProjects();
  const entry = projects.find((p) => p.path === projectPath);
  if (entry) {
    if (floatingChat) {
      entry.floatingChat = floatingChat;
    } else {
      delete entry.floatingChat;
    }
    settingsStore.set("openProjects", projects);
  }
}
```

- [ ] **Step 3: Add IPC handler and extend restore-projects**

In `packages/app/electron/ipc/project.ts`, add the new import:

```typescript
import {
  // ...existing
  updateProjectFloatingChat,
} from "../settings.js";
```

Add the handler after the `set-project-last-route` handler:

```typescript
ipcMain.handle("set-project-floating-chat", (_event, projectPath: string, floatingChat: unknown) => {
  updateProjectFloatingChat(projectPath, floatingChat as OpenProjectEntry["floatingChat"]);
});
```

Extend `restore-projects` to include `floatingChat` in the result. Change the results type and push:

```typescript
const results: Array<{ path: string; name: string; port: number; lastRoute?: string; floatingChat?: OpenProjectEntry["floatingChat"] }> = [];
// ... in the loop, change push calls to include floatingChat:
results.push({ path: entry.path, name: entry.name, port, lastRoute: entry.lastRoute, floatingChat: entry.floatingChat });
```

Apply this to both push calls in the loop (the `try` branch and the `else` branch).

- [ ] **Step 4: Expose in preload.ts**

Add to the `electronAPI` object in `packages/app/electron/preload.ts`:

```typescript
setProjectFloatingChat: (projectRoot: string, floatingChat: unknown) =>
  ipcRenderer.invoke("set-project-floating-chat", projectRoot, floatingChat),
```

- [ ] **Step 5: Restore floatingChat in app-store restoreProjects**

In `packages/app/src/stores/app-store.ts`, extend the `restoreProjects` loop to include `floatingChat`:

Change the destructuring:
```typescript
for (const { path, name, port, lastRoute, floatingChat } of restored) {
```

And include it in the project object:
```typescript
projects.set(key, {
  key,
  path,
  name,
  port,
  ctx: initAppContext(port, path),
  lastRoute,
  floatingChat,
});
```

- [ ] **Step 6: Add tests for setFloatingChat**

In `packages/app/src/stores/app-store.test.ts`, add `setProjectFloatingChat` to the mock:

```typescript
const electronAPI = {
  // ...existing
  setProjectFloatingChat: vi.fn(),
};
```

Add test:

```typescript
it("sets and clears floatingChat for a project", () => {
  useAppStore.setState({
    projects: new Map([["project-a", projectState()]]),
    activeProjectKey: "project-a",
    initializing: false,
  });

  const floatingState = {
    sessionId: "session-1",
    position: { x: 100, y: 200 },
    size: { width: 420, height: 600 },
  };

  useAppStore.getState().setFloatingChat("project-a", floatingState);

  expect(useAppStore.getState().projects.get("project-a")?.floatingChat).toEqual(floatingState);
  expect(electronAPI.setProjectFloatingChat).toHaveBeenCalledWith("/tmp/project-a", floatingState);

  useAppStore.getState().setFloatingChat("project-a", null);

  expect(useAppStore.getState().projects.get("project-a")?.floatingChat).toBeUndefined();
  expect(electronAPI.setProjectFloatingChat).toHaveBeenCalledWith("/tmp/project-a", null);
});

it("restores floatingChat from persisted data", async () => {
  const floatingState = {
    sessionId: "session-1",
    position: { x: 100, y: 200 },
    size: { width: 420, height: 600 },
  };
  electronAPI.restoreProjects.mockResolvedValue([
    { path: "/tmp/project-a", name: "project-a", port: 5173, lastRoute: undefined, floatingChat: floatingState },
  ]);
  electronAPI.getLastActiveProject.mockResolvedValue("/tmp/project-a");

  await useAppStore.getState().restoreProjects();

  expect(useAppStore.getState().projects.get("project-a")?.floatingChat).toEqual(floatingState);
});
```

- [ ] **Step 7: Run tests**

Run: `npm test --workspace=packages/app`
Expected: All tests pass, including new ones.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/stores/app-store.ts packages/app/src/stores/app-store.test.ts packages/app/electron/settings.ts packages/app/electron/ipc/project.ts packages/app/electron/preload.ts packages/app/src/features/floating-chat/defaults.ts
git commit -m "feat: add FloatingChatState to app-store with IPC persistence"
```

---

### Task 2: Drag and resize hooks

**Files:**
- Create: `packages/app/src/features/floating-chat/use-drag.ts`
- Create: `packages/app/src/features/floating-chat/use-resize.ts`

- [ ] **Step 1: Create use-drag.ts**

```typescript
import { useCallback, useRef } from "react";

interface Position {
  x: number;
  y: number;
}

interface UseDragOptions {
  position: Position;
  onPositionChange: (pos: Position) => void;
  onCommit: (pos: Position) => void;
  containerWidth: number;
  containerHeight: number;
}

export function useDrag({ position, onPositionChange, onCommit, containerWidth, containerHeight }: UseDragOptions) {
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(dragRef.current.startPosX + dx, window.innerWidth - containerWidth));
      const newY = Math.max(0, Math.min(dragRef.current.startPosY + dy, window.innerHeight - containerHeight));
      onPositionChange({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(dragRef.current.startPosX + dx, window.innerWidth - containerWidth));
      const newY = Math.max(0, Math.min(dragRef.current.startPosY + dy, window.innerHeight - containerHeight));
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      onCommit({ x: newX, y: newY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [position.x, position.y, containerWidth, containerHeight, onPositionChange, onCommit]);

  return { onMouseDown: handleMouseDown };
}
```

- [ ] **Step 2: Create use-resize.ts**

```typescript
import { useCallback, useRef } from "react";

interface Size {
  width: number;
  height: number;
}

interface UseResizeOptions {
  size: Size;
  onSizeChange: (size: Size) => void;
  onCommit: (size: Size) => void;
  minWidth: number;
  minHeight: number;
}

export function useResize({ size, onSizeChange, onCommit, minWidth, minHeight }: UseResizeOptions) {
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
      const newW = Math.max(minWidth, resizeRef.current.startW + dx);
      const newH = Math.max(minHeight, resizeRef.current.startH + dy);
      onSizeChange({ width: newW, height: newH });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
      const newW = Math.max(minWidth, resizeRef.current.startW + dx);
      const newH = Math.max(minHeight, resizeRef.current.startH + dy);
      resizeRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      onCommit({ width: newW, height: newH });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [size.width, size.height, minWidth, minHeight, onSizeChange, onCommit]);

  return { onMouseDown: handleMouseDown };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/features/floating-chat/use-drag.ts packages/app/src/features/floating-chat/use-resize.ts
git commit -m "feat: add drag and resize hooks for floating chat"
```

---

### Task 3: FloatingChatFrame component

**Files:**
- Create: `packages/app/src/features/floating-chat/FloatingChatFrame.tsx`

- [ ] **Step 1: Create FloatingChatFrame.tsx**

```tsx
import { useState } from "react";
import type { ReactNode } from "react";
import { XIcon, GripVertical } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { useDrag } from "./use-drag";
import { useResize } from "./use-resize";
import { FLOAT_MIN_WIDTH, FLOAT_MIN_HEIGHT } from "./defaults";

interface FloatingChatFrameProps {
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionCommit: (pos: { x: number; y: number }) => void;
  onSizeCommit: (size: { width: number; height: number }) => void;
  onClose: () => void;
  children: ReactNode;
}

export function FloatingChatFrame({
  title,
  position: initialPosition,
  size: initialSize,
  onPositionCommit,
  onSizeCommit,
  onClose,
  children,
}: FloatingChatFrameProps) {
  const { t } = useI18n();
  const [position, setPosition] = useState(initialPosition);
  const [size, setSize] = useState(initialSize);

  const drag = useDrag({
    position,
    onPositionChange: setPosition,
    onCommit: onPositionCommit,
    containerWidth: size.width,
    containerHeight: size.height,
  });

  const resize = useResize({
    size,
    onSizeChange: setSize,
    onCommit: onSizeCommit,
    minWidth: FLOAT_MIN_WIDTH,
    minHeight: FLOAT_MIN_HEIGHT,
  });

  return (
    <div
      data-chat-float-root
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg"
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      <div
        data-chat-float-titlebar
        className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5 cursor-move select-none"
        {...drag}
      >
        <span className="text-xs font-medium truncate">{title}</span>
        <div className="ml-auto">
          <button
            onClick={onClose}
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm hover:bg-muted-foreground/10"
            aria-label={t("common.close")}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        {...resize}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground/50 rotate-[-45deg]" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/features/floating-chat/FloatingChatFrame.tsx
git commit -m "feat: add FloatingChatFrame component with drag/resize/close"
```

---

### Task 4: FloatingChatContainer and FloatingChatManager

**Files:**
- Create: `packages/app/src/features/floating-chat/FloatingChatContainer.tsx`
- Create: `packages/app/src/features/floating-chat/FloatingChatManager.tsx`
- Create: `packages/app/src/features/floating-chat/index.ts`

- [ ] **Step 1: Create FloatingChatContainer.tsx**

This component handles Portal rendering and agent theme injection. It reuses the `scopeCss` logic from `useAgentTheme` but scopes to `[data-chat-float-root]` instead.

```tsx
import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import type { ApiClient } from "../../lib/api";
import type { AgentProfile } from "../../lib/types";
import { Chat } from "../chat";
import { FloatingChatFrame } from "./FloatingChatFrame";
import { useAppStore, type FloatingChatState } from "../../stores/app-store";

function scopeCssToFloat(css: string): string {
  const SCOPE = "[data-chat-float-root]";
  const lines = css.split("\n");
  const result: string[] = [];
  let inBlock = 0;
  let buffer = "";

  for (const line of lines) {
    for (const ch of line) {
      if (ch === "{") inBlock++;
      else if (ch === "}") inBlock--;
    }
    buffer += line + "\n";
    if (inBlock === 0 && buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("@")) {
        result.push(trimmed);
      } else if (trimmed.startsWith("--") || /^[a-z-]+\s*:/.test(trimmed)) {
        result.push(`${SCOPE} { ${trimmed} }`);
      } else {
        const scoped = trimmed.replace(
          /^([^@{}/]+?)(\s*\{)/gm,
          (_, selectors, brace) => {
            const prefixed = selectors
              .split(",")
              .map((s: string) => `${SCOPE} ${s.trim()}`)
              .join(", ");
            return `${prefixed}${brace}`;
          },
        );
        result.push(scoped);
      }
      buffer = "";
    }
  }
  if (buffer.trim()) result.push(`${SCOPE} { ${buffer.trim()} }`);
  return result.join("\n\n");
}

interface FloatingChatContainerProps {
  projectKey: string;
  floatingChat: FloatingChatState;
  agent: AgentProfile;
  client: ApiClient;
  port: number;
}

export function FloatingChatContainer({
  projectKey,
  floatingChat,
  agent,
  client,
  port,
}: FloatingChatContainerProps) {
  const setFloatingChat = useAppStore((s) => s.setFloatingChat);
  const [scopedThemeCss, setScopedThemeCss] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.getAgentTheme(agent.id).then((css) => {
      if (cancelled) return;
      if (css.trim()) {
        setScopedThemeCss(scopeCssToFloat(css));
      } else {
        setScopedThemeCss(null);
      }
    });
    return () => { cancelled = true; };
  }, [client, agent.id]);

  const handleClose = () => {
    setFloatingChat(projectKey, null);
  };

  const handlePositionCommit = (pos: { x: number; y: number }) => {
    setFloatingChat(projectKey, { ...floatingChat, position: pos });
  };

  const handleSizeCommit = (size: { width: number; height: number }) => {
    setFloatingChat(projectKey, { ...floatingChat, size });
  };

  return createPortal(
    <div className="floating-chat-portal">
      {scopedThemeCss && <style>{scopedThemeCss}</style>}
      <FloatingChatFrame
        title={agent.name}
        position={floatingChat.position}
        size={floatingChat.size}
        onPositionCommit={handlePositionCommit}
        onSizeCommit={handleSizeCommit}
        onClose={handleClose}
      >
        <Chat
          client={client}
          sessionId={floatingChat.sessionId}
          port={port}
          agent={agent}
        />
      </FloatingChatFrame>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Create FloatingChatManager.tsx**

```tsx
import { useAppStore } from "../../stores/app-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { FloatingChatContainer } from "./FloatingChatContainer";

export function FloatingChatManager() {
  const activeProjectKey = useAppStore((s) => s.activeProjectKey);
  const setFloatingChat = useAppStore((s) => s.setFloatingChat);
  const project = useAppStore((s) =>
    s.activeProjectKey ? s.projects.get(s.activeProjectKey) : undefined,
  );
  const projectData = useProjectDataStore((s) =>
    activeProjectKey ? s.projects[activeProjectKey] : undefined,
  );

  const floatingChat = project?.floatingChat;
  if (!floatingChat || !activeProjectKey) return null;

  const sessions = projectData?.sessions ?? [];
  const agents = projectData?.agents ?? [];
  const session = sessions.find((s) => s.id === floatingChat.sessionId);
  if (!session) {
    setFloatingChat(activeProjectKey, null);
    return null;
  }

  const agent = agents.find((a) => a.id === session.agentId);
  if (!agent) return null;

  return (
    <FloatingChatContainer
      projectKey={activeProjectKey}
      floatingChat={floatingChat}
      agent={agent}
      client={project.ctx.client}
      port={project.ctx.port}
    />
  );
}
```

- [ ] **Step 3: Create index.ts barrel**

```typescript
export { FloatingChatManager } from "./FloatingChatManager";
export { getDefaultFloatingState } from "./defaults";
export type { FloatingChatState } from "../../stores/app-store";
```

- [ ] **Step 4: Wire into App.tsx**

In `packages/app/src/App.tsx`, add the import:

```typescript
import { FloatingChatManager } from "./features/floating-chat";
```

Add `<FloatingChatManager />` inside the root `<div>`, after `<Outlet />` and before `{showSettings && ...}`:

```tsx
<Outlet />
<FloatingChatManager />
{showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/features/floating-chat/FloatingChatContainer.tsx packages/app/src/features/floating-chat/FloatingChatManager.tsx packages/app/src/features/floating-chat/index.ts packages/app/src/App.tsx
git commit -m "feat: add FloatingChatManager and FloatingChatContainer with Portal rendering"
```

---

### Task 5: Right-click context menu — Float / Cancel Float

**Files:**
- Modify: `packages/app/src/features/agent-session-list/SessionRow.tsx`
- Modify: `packages/app/src/features/agent-session-list/AgentSessionList.tsx`

- [ ] **Step 1: Add i18n strings**

In `packages/i18n/src/locales/zh-CN.ts`, add after the `agent-session-list.groupLabel` comment:

```typescript
// 右键菜单：将对话显示为浮窗
"agent-session-list.floatSession": "浮窗",
// 右键菜单：取消对话浮窗
"agent-session-list.cancelFloat": "取消浮窗",
```

Add equivalent entries to `zh-TW.ts` and `en.ts`:

zh-TW:
```typescript
"agent-session-list.floatSession": "浮動視窗",
"agent-session-list.cancelFloat": "取消浮動視窗",
```

en:
```typescript
// Right-click menu: show session as floating window
"agent-session-list.floatSession": "Float",
// Right-click menu: cancel session floating window
"agent-session-list.cancelFloat": "Cancel Float",
```

- [ ] **Step 2: Add props to SessionRow**

In `packages/app/src/features/agent-session-list/SessionRow.tsx`, update the interface:

```typescript
interface SessionRowProps {
  session: SessionInfo;
  active: boolean;
  floating: boolean;
  onSelect: (session: SessionInfo) => void;
  onDelete: (session: SessionInfo) => void;
  onRename: (session: SessionInfo, title: string) => Promise<boolean>;
  onFloat: (session: SessionInfo) => void;
  onCancelFloat: () => void;
}
```

Add the float/cancel float menu items in `ContextMenuContent`:

```tsx
<ContextMenuContent>
  <ContextMenuItem onClick={startEditing}>
    {t("common.rename")}
  </ContextMenuItem>
  <ContextMenuSeparator />
  {floating ? (
    <ContextMenuItem onClick={onCancelFloat}>
      {t("agent-session-list.cancelFloat")}
    </ContextMenuItem>
  ) : (
    <ContextMenuItem onClick={() => onFloat(session)}>
      {t("agent-session-list.floatSession")}
    </ContextMenuItem>
  )}
  <ContextMenuSeparator />
  <ContextMenuItem variant="destructive" onClick={() => onDelete(session)}>
    {t("common.delete")}
  </ContextMenuItem>
</ContextMenuContent>
```

- [ ] **Step 3: Pass props from AgentSessionList**

In `packages/app/src/features/agent-session-list/AgentSessionList.tsx`, import the store and pass new props:

```typescript
import { useAppStore } from "../../stores/app-store";
import { getDefaultFloatingState } from "../floating-chat";
```

Inside the component, read floating state:

```typescript
const setFloatingChat = useAppStore((s) => s.setFloatingChat);
const project = useAppStore((s) =>
  s.activeProjectKey ? s.projects.get(s.activeProjectKey) : undefined,
);
const floatingSessionId = project?.floatingChat?.sessionId;
```

Pass to each `SessionRow`:

```tsx
<SessionRow
  session={session}
  active={active}
  floating={session.id === floatingSessionId}
  onSelect={onSelectSession}
  onDelete={handleDeleteSession}
  onRename={handleRenameSession}
  onFloat={(s) => {
    setFloatingChat(activeProjectKey, getDefaultFloatingState(s.id));
  }}
  onCancelFloat={() => {
    setFloatingChat(activeProjectKey, null);
  }}
/>
```

Note: The `activeProjectKey` is already available in this component. If this session is currently open in the main window, `ProjectLayout` will handle navigation — the SessionRow just sets the floating state. The design says "if the session is currently open in main chat page, close chat page." This should be handled in `ProjectLayout` by checking if the floated session matches the active route — add a `useEffect` in `ProjectLayout`:

In `packages/app/src/layouts/ProjectLayout.tsx`, add:

```typescript
const floatingChat = useAppStore((s) =>
  s.activeProjectKey ? s.projects.get(s.activeProjectKey)?.floatingChat : undefined,
);

useEffect(() => {
  if (!floatingChat) return;
  if (activeSessionId === floatingChat.sessionId) {
    navigate(`/project/${projectKey}`);
  }
}, [floatingChat?.sessionId, activeSessionId, navigate, projectKey]);
```

This effect runs when `floatingChat.sessionId` changes (i.e., a session was just floated). If the session being floated is currently shown in the main chat, navigate away.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/features/agent-session-list/SessionRow.tsx packages/app/src/features/agent-session-list/AgentSessionList.tsx packages/app/src/layouts/ProjectLayout.tsx packages/i18n/src/locales/zh-CN.ts packages/i18n/src/locales/zh-TW.ts packages/i18n/src/locales/en.ts
git commit -m "feat: add Float/Cancel Float to session context menu"
```

---

### Task 6: UI SDK integration — floatSession, unfloatSession, extend createSession/sendMessage

**Files:**
- Create: `packages/app/src/ui-sdk/handlers/float-session.ts`
- Create: `packages/app/src/ui-sdk/handlers/unfloat-session.ts`
- Modify: `packages/app/src/ui-sdk/handlers/create-session.ts`
- Modify: `packages/app/src/ui-sdk/handlers/send-message.ts`
- Modify: `packages/app/src/ui-sdk/index.ts`

- [ ] **Step 1: Create float-session.ts**

```typescript
import { registerAction } from "../registry";
import { useAppStore } from "../../stores/app-store";
import { getDefaultFloatingState } from "../../features/floating-chat";

registerAction("floatSession", (params, ctx) => {
  const { sessionId } = params as { sessionId: string };
  if (!sessionId || typeof sessionId !== "string") return;
  useAppStore.getState().setFloatingChat(ctx.projectKey, getDefaultFloatingState(sessionId));
});
```

- [ ] **Step 2: Create unfloat-session.ts**

```typescript
import { registerAction } from "../registry";
import { useAppStore } from "../../stores/app-store";

registerAction("unfloatSession", (_params, ctx) => {
  const project = useAppStore.getState().projects.get(ctx.projectKey);
  if (!project?.floatingChat) return;
  useAppStore.getState().setFloatingChat(ctx.projectKey, null);
});
```

- [ ] **Step 3: Extend create-session.ts with `float` param**

Replace the entire file:

```typescript
import { registerAction } from "../registry";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useAppStore } from "../../stores/app-store";
import { getDefaultFloatingState } from "../../features/floating-chat";

registerAction("createSession", async (params, ctx) => {
  const { agentId, message, float } = params as {
    agentId: string;
    message?: string;
    float?: boolean;
  };
  if (!agentId || typeof agentId !== "string") return;
  if (!ctx.client) return;

  const session = await useProjectDataStore
    .getState()
    .createSession(ctx.projectKey, ctx.client, agentId, message);
  if (!session) return;

  if (float) {
    useAppStore.getState().setFloatingChat(ctx.projectKey, getDefaultFloatingState(session.id));
  } else {
    ctx.navigate(`/project/${ctx.projectKey}/chat/${session.id}`);
  }
});
```

- [ ] **Step 4: Extend send-message.ts with `float` param**

Replace the entire file:

```typescript
import { registerAction } from "../registry";
import { useStreamingStore } from "../../features/chat/streaming-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useAppStore } from "../../stores/app-store";
import { getDefaultFloatingState } from "../../features/floating-chat";

registerAction("sendMessage", (params, ctx) => {
  const { sessionId, message, float } = params as {
    sessionId: string;
    message: string;
    float?: boolean;
  };
  if (!sessionId || typeof sessionId !== "string") return;
  if (!message || typeof message !== "string") return;

  const { sendMessage: wsSend, sessions } = useStreamingStore.getState();
  const ws = sessions[sessionId]?.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    wsSend(sessionId, message);
  } else {
    useProjectDataStore.getState().setInitialMessage(ctx.projectKey, sessionId, message);
  }

  if (float) {
    const project = useAppStore.getState().projects.get(ctx.projectKey);
    if (project?.floatingChat?.sessionId !== sessionId) {
      useAppStore.getState().setFloatingChat(ctx.projectKey, getDefaultFloatingState(sessionId));
    }
  } else {
    ctx.navigate(`/project/${ctx.projectKey}/chat/${sessionId}`);
  }
});
```

- [ ] **Step 5: Update index.ts**

```typescript
import "./handlers/create-session";
import "./handlers/float-session";
import "./handlers/open-file";
import "./handlers/send-message";
import "./handlers/unfloat-session";

export { dispatchAction } from "./registry";
export { useSpherseMessageListener } from "./use-spherse-message-listener";
```

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/ui-sdk/handlers/float-session.ts packages/app/src/ui-sdk/handlers/unfloat-session.ts packages/app/src/ui-sdk/handlers/create-session.ts packages/app/src/ui-sdk/handlers/send-message.ts packages/app/src/ui-sdk/index.ts
git commit -m "feat: add floatSession/unfloatSession UI SDK actions and float param"
```

---

### Task 7: Skill docs and theme docs update

**Files:**
- Modify: `packages/presets/skills/create-agent-chat-theme/SKILL.md`
- Modify: `packages/presets/skills/use-ui-sdk/SKILL.md`

- [ ] **Step 1: Update create-agent-chat-theme SKILL.md**

Add a "Floating Chat Selectors" section documenting:

| Selector | Description |
|---|---|
| `[data-chat-float-root]` | Floating window container. Customize border, border-radius, box-shadow, background, backdrop-filter. |
| `[data-chat-float-titlebar]` | Title bar area. Customize background, text color, padding. |
| `[data-chat-float-titlebar] button` | Close button. Customize icon color, hover state. |

Include a CSS example:

```css
[data-chat-float-root] {
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(12px);
  background: rgba(30, 30, 40, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

[data-chat-float-titlebar] {
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
}

[data-chat-float-titlebar] button:hover {
  background: rgba(255, 255, 255, 0.15);
}
```

Explain that the same `theme.css` file covers both inline and floating chat — `[data-chat-root]` selectors apply to both (since `data-chat-root` is a child of `data-chat-float-root`), while `[data-chat-float-root]` selectors only affect the floating window appearance.

- [ ] **Step 2: Update use-ui-sdk SKILL.md**

Add `floatSession` and `unfloatSession` action documentation:

```
### `floatSession`

Float a session into a floating overlay window.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | The session ID to float |

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "floatSession",
  params: { sessionId: "session-id" }
}, "*");
```

### `unfloatSession`

Close the current floating chat window.

No parameters required.

```javascript
window.parent.postMessage({
  type: "spherse:action",
  action: "unfloatSession",
  params: {}
}, "*");
```
```

Add `float` parameter to `createSession` and `sendMessage` documentation:

In `createSession` params table, add:

```
| `float` | boolean | No | If `true`, open the new session in a floating window instead of navigating |
```

In `sendMessage` params table, add:

```
| `float` | boolean | No | If `true`, ensure the session is floating before sending the message |
```

- [ ] **Step 3: Commit**

```bash
git add packages/presets/skills/create-agent-chat-theme/SKILL.md packages/presets/skills/use-ui-sdk/SKILL.md
git commit -m "docs: update skill docs with floating chat selectors and UI SDK actions"
```

---

### Task 8: Lint and verify

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 2: Run app tests**

Run: `npm test --workspace=packages/app`
Expected: All tests pass

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: Successful build

- [ ] **Step 4: Final commit if any fixes needed**
