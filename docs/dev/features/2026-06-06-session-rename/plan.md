# Session Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to rename sessions inline from the sidebar and persist the title in `.spherse/sessions.db`.

**Architecture:** Reuse the existing `sessions.title` column and `SessionStore.updateSessionTitle` storage primitive. Expose a narrow rename path through `Engine.renameSession`, `PATCH /api/sessions/:id`, the renderer API client, `project-data-store`, and `SessionRow` inline editing. Keep active chat/session runtime untouched and do not update `updated_at`.

**Tech Stack:** TypeScript ESM, better-sqlite3, Fastify, React 19, Zustand, Base UI/shadcn local components, Sonner toast, Vitest.

---

## File Structure

- Modify `packages/core/src/engine.ts`: add `renameSession(sessionId, title): SessionInfo` with validation, existence check, persistence, and updated session return.
- Create `packages/core/src/__tests__/engine.test.ts`: cover `Engine.renameSession` success and validation/not-found failures with minimal fake stores.
- Modify `packages/server/src/routes/sessions.ts`: add `PATCH /api/sessions/:id` and map validation errors to 400 and missing session to 404.
- Server route behavior is verified by TypeScript build and manual API/app verification because `packages/server` currently has no test script or Vitest setup; do not add server test infrastructure for this focused feature.
- Modify `packages/app/src/lib/api.ts`: add `renameSession(id, title): Promise<SessionInfo>` to the API client.
- Modify `packages/app/src/stores/project-data-store.ts`: add `renameSession(projectKey, client, sessionId, title): Promise<boolean>` and update the cached session on success.
- Modify `packages/app/src/stores/project-data-store.test.ts`: cover successful rename, failure, and cleared-project late response behavior.
- Modify `packages/app/src/features/agent-session-list/index.tsx`: wire the store action into the session list and call `toast.error` on failed rename.
- Modify `packages/app/src/features/agent-session-list/AgentSessionListView.tsx`: pass `onRenameSession` down to each agent group.
- Modify `packages/app/src/features/agent-session-list/AgentGroup.tsx`: pass `onRenameSession` down to each session row.
- Modify `packages/app/src/features/agent-session-list/SessionRow.tsx`: implement inline editing state, input focus/select, Enter save, Escape/blur cancel, local validation, and saving disabled state.
- Modify `docs/official/data-conventions.md`: document that `sessions.title` is user-editable and rename does not change `updated_at`.
- Modify `docs/dev/backlog.md`: add and mark the Session 重命名 backlog item complete after implementation.

## Task 1: Core Rename API

**Files:**
- Modify: `packages/core/src/engine.ts`
- Create: `packages/core/src/__tests__/engine.test.ts`

- [ ] **Step 1: Add failing tests for `Engine.renameSession`**

Create `packages/core/src/__tests__/engine.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { Engine } from "../engine.js";
import type { SessionInfo } from "../types.js";

function createEngineWithSessions(initial: Record<string, SessionInfo>) {
  const sessions = new Map(Object.entries(initial));
  const sessionStore = {
    getSession: vi.fn((id: string) => sessions.get(id) ?? null),
    updateSessionTitle: vi.fn((id: string, title: string) => {
      const session = sessions.get(id);
      if (session) sessions.set(id, { ...session, title });
    }),
  };

  const engine = new Engine(
    {} as ConstructorParameters<typeof Engine>[0],
    sessionStore as ConstructorParameters<typeof Engine>[1],
    {} as ConstructorParameters<typeof Engine>[2],
    {} as ConstructorParameters<typeof Engine>[3],
  );

  return { engine, sessionStore };
}

describe("Engine.renameSession", () => {
  it("renames an existing session and returns the updated session", () => {
    const session: SessionInfo = {
      id: "session-1",
      agentId: "agent-1",
      createdAt: 1,
      updatedAt: 2,
      status: "active",
    };
    const { engine, sessionStore } = createEngineWithSessions({ "session-1": session });

    const updated = engine.renameSession("session-1", "  New Title  ");

    expect(sessionStore.updateSessionTitle).toHaveBeenCalledWith("session-1", "New Title");
    expect(updated).toEqual({ ...session, title: "New Title" });
    expect(updated.updatedAt).toBe(2);
  });

  it("rejects an empty title", () => {
    const { engine } = createEngineWithSessions({
      "session-1": {
        id: "session-1",
        agentId: "agent-1",
        createdAt: 1,
        updatedAt: 2,
        status: "active",
      },
    });

    expect(() => engine.renameSession("session-1", "   ")).toThrow("title is required");
  });

  it("rejects a title longer than 80 characters", () => {
    const { engine } = createEngineWithSessions({
      "session-1": {
        id: "session-1",
        agentId: "agent-1",
        createdAt: 1,
        updatedAt: 2,
        status: "active",
      },
    });

    expect(() => engine.renameSession("session-1", "a".repeat(81))).toThrow(
      "title must be 80 characters or less",
    );
  });

  it("throws when the session does not exist", () => {
    const { engine } = createEngineWithSessions({});

    expect(() => engine.renameSession("missing", "New Title")).toThrow(
      'Session "missing" not found',
    );
  });
});
```

- [ ] **Step 2: Run the failing core test**

Run: `npm test --workspace=packages/core -- engine.test.ts`

Expected: FAIL because `engine.renameSession` does not exist.

- [ ] **Step 3: Implement `Engine.renameSession`**

In `packages/core/src/engine.ts`, add this public method after `listSessions`:

```ts
  renameSession(sessionId: string, title: string): SessionInfo {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new Error("title is required");
    if (trimmedTitle.length > 80) {
      throw new Error("title must be 80 characters or less");
    }

    const session = this.sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    this.sessionStore.updateSessionTitle(sessionId, trimmedTitle);
    return { ...session, title: trimmedTitle };
  }
```

No `updatedAt` update is needed. Do not modify active session runtime state.

- [ ] **Step 4: Run the core test again**

Run: `npm test --workspace=packages/core -- engine.test.ts`

Expected: PASS.

- [ ] **Step 5: Run existing session store tests**

Run: `npm test --workspace=packages/core -- session.test.ts`

Expected: PASS, confirming existing title storage behavior still works.

## Task 2: Server PATCH Route

**Files:**
- Modify: `packages/server/src/routes/sessions.ts`

- [ ] **Step 1: Add `PATCH /api/sessions/:id` route**

In `packages/server/src/routes/sessions.ts`, insert this route between the existing `GET /api/sessions/:id/messages` route and the `DELETE /api/sessions/:id` route:

```ts
  fastify.patch<{ Params: { id: string }; Body: { title?: unknown } }>(
    "/api/sessions/:id",
    async (req, reply) => {
      const { title } = req.body ?? {};
      if (typeof title !== "string") {
        return reply.code(400).send({ error: "title is required" });
      }

      try {
        return ctx.engine.renameSession(req.params.id, title);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : "request failed";
        if (message.includes("not found")) {
          return reply.code(404).send({ error: message });
        }
        return reply.code(400).send({ error: message });
      }
    },
  );
```

This relies on core validation for trim-empty and length checks, keeping validation rules in one place.

- [ ] **Step 2: Build server to verify route typing**

Run: `npm run build --workspace=packages/server`

Expected: PASS. If TypeScript reports that `renameSession` is missing from Engine, ensure Task 1 is complete and `@spherse/core` is built or TypeScript can resolve workspace source types.

- [ ] **Step 3: Build core and server together if server build uses stale core output**

Run: `npm run build --workspace=packages/core && npm run build --workspace=packages/server`

Expected: PASS.

## Task 3: Renderer API And Store

**Files:**
- Modify: `packages/app/src/lib/api.ts`
- Modify: `packages/app/src/stores/project-data-store.ts`
- Modify: `packages/app/src/stores/project-data-store.test.ts`

- [ ] **Step 1: Add failing store tests for rename behavior**

In `packages/app/src/stores/project-data-store.test.ts`, update `createClient` to include a default `renameSession` function:

```ts
    renameSession: vi.fn().mockResolvedValue({
      id: "session-1",
      agentId: "agent-1",
      title: "Renamed Session",
      createdAt: 1,
      updatedAt: 1,
      status: "active",
    }),
```

Add these tests before the final `});`:

```ts
  it("renames a session in the project cache", async () => {
    const client = createClient({
      listSessions: vi.fn().mockResolvedValue([createSession("session-1")]),
      renameSession: vi.fn().mockResolvedValue({
        ...createSession("session-1"),
        title: "Renamed Session",
      }),
    });

    await useProjectDataStore.getState().refreshSessions("project-1", client);
    const ok = await useProjectDataStore.getState().renameSession(
      "project-1",
      client,
      "session-1",
      "Renamed Session",
    );

    expect(ok).toBe(true);
    expect(client.renameSession).toHaveBeenCalledWith("session-1", "Renamed Session");
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toEqual([
      { ...createSession("session-1"), title: "Renamed Session" },
    ]);
  });

  it("keeps the existing session title when rename fails", async () => {
    const original = { ...createSession("session-1"), title: "Original" };
    const client = createClient({
      listSessions: vi.fn().mockResolvedValue([original]),
      renameSession: vi.fn().mockRejectedValue(new Error("rename failed")),
    });

    await useProjectDataStore.getState().refreshSessions("project-1", client);
    const ok = await useProjectDataStore.getState().renameSession(
      "project-1",
      client,
      "session-1",
      "New Title",
    );

    expect(ok).toBe(false);
    expect(useProjectDataStore.getState().projects["project-1"]?.sessions).toEqual([original]);
    expect(useProjectDataStore.getState().projects["project-1"]?.error).toBe("rename failed");
  });

  it("does not recreate a cleared project when a rename resolves late", async () => {
    let resolveRename: (session: SessionInfo) => void = () => {};
    const client = createClient({
      listSessions: vi.fn().mockResolvedValue([createSession("session-1")]),
      renameSession: vi.fn().mockReturnValue(new Promise<SessionInfo>((resolve) => {
        resolveRename = resolve;
      })),
    });

    await useProjectDataStore.getState().refreshSessions("project-1", client);
    const rename = useProjectDataStore.getState().renameSession(
      "project-1",
      client,
      "session-1",
      "Renamed Session",
    );
    useProjectDataStore.getState().clearProjectData("project-1");
    resolveRename({ ...createSession("session-1"), title: "Renamed Session" });
    await rename;

    expect(useProjectDataStore.getState().projects["project-1"]).toBeUndefined();
  });
```

- [ ] **Step 2: Run failing app store tests**

Run: `npm test --workspace=packages/app -- project-data-store.test.ts`

Expected: FAIL because `renameSession` is missing from `ApiClient` and `ProjectDataStore`.

- [ ] **Step 3: Add API client method**

In `packages/app/src/lib/api.ts`, add this method near `deleteSession`:

```ts
    async renameSession(id: string, title: string): Promise<SessionInfo> {
      const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },
```

- [ ] **Step 4: Add store type and implementation**

In `packages/app/src/stores/project-data-store.ts`, add to `ProjectDataStore`:

```ts
  renameSession: (projectKey: string, client: ApiClient, sessionId: string, title: string) => Promise<boolean>;
```

Add implementation after `deleteSession`:

```ts
  async renameSession(projectKey, client, sessionId, title) {
    try {
      const updatedSession = await client.renameSession(sessionId, title);
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        sessions: project.sessions.map((session) =>
          session.id === sessionId ? updatedSession : session,
        ),
        error: null,
      }), { createIfMissing: false }));
      return true;
    } catch (err) {
      set((state) => updateProjectData(state, projectKey, (project) => ({
        ...project,
        error: getErrorMessage(err),
      }), { createIfMissing: false }));
      return false;
    }
  },
```

- [ ] **Step 5: Run app store tests again**

Run: `npm test --workspace=packages/app -- project-data-store.test.ts`

Expected: PASS.

## Task 4: Inline Sidebar Rename UI

**Files:**
- Modify: `packages/app/src/features/agent-session-list/index.tsx`
- Modify: `packages/app/src/features/agent-session-list/AgentSessionListView.tsx`
- Modify: `packages/app/src/features/agent-session-list/AgentGroup.tsx`
- Modify: `packages/app/src/features/agent-session-list/SessionRow.tsx`

- [ ] **Step 1: Wire rename action from feature root**

In `packages/app/src/features/agent-session-list/index.tsx`, import toast:

```ts
import { toast } from "sonner";
```

Read the store action:

```ts
  const renameSession = useProjectDataStore((state) => state.renameSession);
```

Add handler near `handleDeleteSession`:

```ts
  const handleRenameSession = async (session: SessionInfo, title: string) => {
    if (!project) return false;
    const ok = await renameSession(projectKey, project.ctx.client, session.id, title);
    if (!ok) {
      const message = useProjectDataStore.getState().projects[projectKey]?.error ?? "重命名失败";
      toast.error(`重命名失败：${message}`);
    }
    return ok;
  };
```

Pass to `AgentSessionListView`:

```tsx
            onRenameSession={handleRenameSession}
```

- [ ] **Step 2: Pass rename prop through list components**

In `AgentSessionListView.tsx`, add to props:

```ts
  onRenameSession: (session: SessionInfo, title: string) => Promise<boolean>;
```

Destructure it and pass it to `AgentGroup`:

```tsx
          onRenameSession={onRenameSession}
```

In `AgentGroup.tsx`, add to props:

```ts
  onRenameSession: (session: SessionInfo, title: string) => Promise<boolean>;
```

Destructure it and pass it to `SessionRow`:

```tsx
              onRename={onRenameSession}
```

- [ ] **Step 3: Implement inline editing in `SessionRow`**

Replace `packages/app/src/features/agent-session-list/SessionRow.tsx` with this structure, preserving existing imports and adding React/input imports:

```tsx
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SessionInfo } from "../../lib/types";
import { Input } from "../../components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../components/ui/sidebar";
import { MoreHorizontalIcon } from "lucide-react";

interface SessionRowProps {
  session: SessionInfo;
  active: boolean;
  onSelect: (session: SessionInfo) => void;
  onDelete: (sessionId: string) => void;
  onRename: (session: SessionInfo, title: string) => Promise<boolean>;
}

function getFallbackTitle(session: SessionInfo) {
  return new Date(session.updatedAt).toLocaleString();
}

export function SessionRow({ session, active, onSelect, onDelete, onRename }: SessionRowProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fallbackTitle = getFallbackTitle(session);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function startEditing() {
    setDraftTitle(session.title ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    if (saving) return;
    setEditing(false);
    setDraftTitle("");
    setError(null);
  }

  async function saveTitle() {
    const title = draftTitle.trim();
    if (!title) {
      setError("请输入会话名称");
      return;
    }
    if (title.length > 80) {
      setError("会话名称不能超过 80 个字符");
      return;
    }
    if (title === session.title) {
      cancelEditing();
      return;
    }

    setSaving(true);
    const ok = await onRename(session, title);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setDraftTitle("");
      setError(null);
    } else {
      setEditing(false);
      setDraftTitle("");
      setError(null);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveTitle();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
    }
  }

  return (
    <SidebarMenuSubItem className="group/session-row">
      {editing ? (
        <div className="pr-6">
          <Input
            ref={inputRef}
            value={draftTitle}
            placeholder={fallbackTitle}
            disabled={saving}
            aria-invalid={error ? true : undefined}
            className="h-6 text-xs"
            onChange={(e) => {
              setDraftTitle(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            onBlur={cancelEditing}
          />
          {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
        </div>
      ) : (
        <SidebarMenuSubButton
          isActive={active}
          className="cursor-pointer pr-6"
          onClick={() => onSelect(session)}
        >
          <span>{session.title ?? fallbackTitle}</span>
        </SidebarMenuSubButton>
      )}
      {!editing && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction className="top-1 right-0 md:opacity-0 group-hover/session-row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 data-popup-open:opacity-100 data-open:opacity-100" />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={startEditing}>
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(session.id)}>
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuSubItem>
  );
}
```

Implementation notes:

- If `onBlur` fires after pressing Enter, `saving` prevents cancellation while save is in flight.
- API failure exits edit mode and relies on the parent toast, matching the design.
- Local validation errors keep the row in edit mode and show inline text.

- [ ] **Step 4: Build app to validate React/TypeScript wiring**

Run: `npm run build --workspace=packages/app`

Expected: PASS. If lint complains about stale closures or hook deps, keep state local to `SessionRow` and avoid unnecessary `useCallback` unless the existing lint rule requires it.

## Task 5: Docs And Backlog

**Files:**
- Modify: `docs/official/data-conventions.md`
- Modify: `docs/dev/backlog.md`

- [ ] **Step 1: Update official data conventions**

In `docs/official/data-conventions.md`, replace the Session 数据 paragraph at lines 79-83 with:

```md
## Session 数据

Session 数据存储在 `.spherse/sessions.db`。每个 session 通过 `agent_id` 关联 AgentProfile，状态为 `active` 或 `archived`。

`sessions.title` 是可选的用户可编辑展示标题。用户重命名 session 时只更新 `title`，不更新 `updated_at`，因此不会改变 session 列表按最近对话活动排序的行为。

删除 agent 时，Engine 会归档关联 sessions，再删除 agent profile 文件，避免历史对话失去可追溯状态。
```

- [ ] **Step 2: Update backlog**

In `docs/dev/backlog.md`, add this checked item under `## 功能增强` near the existing session items:

```md
- [x] **Session 重命名**：支持从侧边栏原地编辑 session 标题，标题持久化到 `.spherse/sessions.db`。
```

- [ ] **Step 3: Verify docs have no stale Dialog wording**

Run: use Grep for `Dialog|弹窗|对话框` in `docs/dev/features/2026-06-06-session-rename`.

Expected: no matches that describe the final rename UI as dialog-based.

## Task 6: Final Verification

**Files:**
- No new code files beyond prior tasks.

- [ ] **Step 1: Run focused tests**

Run: `npm test --workspace=packages/core -- engine.test.ts session.test.ts`

Expected: PASS.

Run: `npm test --workspace=packages/app -- project-data-store.test.ts`

Expected: PASS.

- [ ] **Step 2: Run builds for touched workspaces**

Run: `npm run build --workspace=packages/core && npm run build --workspace=packages/server && npm run build --workspace=packages/app`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Manual app verification**

Run: `npm run dev`

Expected behavior:

- Open a project with at least one agent and session.
- In the sidebar, open a session row menu and choose `重命名`.
- The row title becomes an inline input and receives focus.
- Empty input plus Enter keeps edit mode and shows `请输入会话名称`.
- More than 80 characters plus Enter keeps edit mode and shows `会话名称不能超过 80 个字符`.
- Valid input plus Enter saves, exits edit mode, and updates the row title.
- Escape cancels without saving.
- Blur cancels without saving.
- Current chat URL remains `/project/:projectKey/chat/:sessionId`.
- Restarting the app still shows the renamed title.

- [ ] **Step 5: Inspect final diff**

Run: `git diff --stat` and `git diff`.

Expected: only the files listed in this plan changed, no unrelated edits, no secrets, no generated artifacts.

Do not commit unless the user explicitly asks for a commit.

## Self-Review Notes

- Spec coverage: plan covers persistence, Engine boundary, server route, API client, Zustand cache update, inline `SessionRow` input, Enter save, Escape/blur cancel, local validation, toast on API failure, unchanged route/runtime, unchanged `updated_at`, official docs, and backlog.
- Placeholder scan: no placeholder tasks remain; each implementation step includes exact files, code, commands, and expected outcomes.
- Type consistency: `renameSession(sessionId, title): SessionInfo` in core, `renameSession(id, title): Promise<SessionInfo>` in API client, and `renameSession(projectKey, client, sessionId, title): Promise<boolean>` in app store are used consistently through UI props.
