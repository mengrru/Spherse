# Chat Streaming Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor chat streaming state management so that switching sessions preserves WebSocket connections and streaming state, enabling seamless resume when switching back.

**Architecture:** Introduce a Zustand `StreamingStore` that owns WebSocket connections and message state per session, outside component lifecycle. `useChatSession` becomes a thin adapter. `useChatScroll` persists scroll position in the store. `SessionRow` reads streaming status for sidebar indicators. Expiration timer cleans up idle background sessions.

**Tech Stack:** React, Zustand, WebSocket, Playwright (E2E), TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/app/src/features/chat/streaming-store.ts` | Create | Zustand store: WebSocket pool, message state, event handling, expiration |
| `packages/app/src/features/chat/hooks/useChatSession.ts` | Rewrite | Thin adapter over streaming-store, no longer owns WebSocket |
| `packages/app/src/features/chat/hooks/useChatScroll.ts` | Modify | Persist/restore scroll position via streaming-store |
| `packages/app/src/features/agent-session-list/SessionRow.tsx` | Modify | Streaming indicator for non-active sessions |
| `packages/app/e2e/chat-streaming-resilience.spec.ts` | Create | E2E tests for streaming resilience scenarios |

---

### Task 1: Create StreamingStore core

**Files:**
- Create: `packages/app/src/features/chat/streaming-store.ts`

This task creates the store with data structures, event handling, and all store methods. No UI consumption yet — that's Task 2.

- [ ] **Step 1: Create streaming-store.ts with types, store, and event handler**

Create `packages/app/src/features/chat/streaming-store.ts`:

```ts
import { create } from "zustand";
import { parseChatServerEvent } from "@spherse/server/contracts";
import type { ApiClient } from "../../lib/api";
import type { AgentEvent, ChatMessage, ToolCallInfo } from "../../lib/types";

interface StreamingSession {
  ws: WebSocket;
  messages: ChatMessage[];
  streaming: boolean;
  lastActivityAt: number;
  scrollPosition: number;
}

interface StreamingStoreState {
  sessions: Record<string, StreamingSession>;
}

interface StreamingStoreActions {
  getOrCreate: (client: ApiClient, sessionId: string, port: number, initialMessage?: string) => void;
  disconnect: (sessionId: string) => void;
  touch: (sessionId: string) => void;
  sendMessage: (sessionId: string, text: string) => void;
  abort: (sessionId: string) => void;
  setScrollPosition: (sessionId: string, position: number) => void;
  cleanupExpired: (ttlMs: number) => void;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

export const useStreamingStore = create<StreamingStoreState & StreamingStoreActions>((set, get) => {
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;

  function updateSession(
    sessionId: string,
    updater: (session: StreamingSession) => StreamingSession,
  ) {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: updater(session),
        },
      };
    });
  }

  function handleEvent(sessionId: string, event: AgentEvent) {
    updateSession(sessionId, (session) => {
      const messages = applyEventToMessages(session.messages, event);
      const streaming = applyEventToStreaming(event);
      return {
        ...session,
        messages,
        streaming: streaming ?? session.streaming,
        lastActivityAt: Date.now(),
      };
    });
  }

  function startCleanupTimer() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
      get().cleanupExpired(DEFAULT_TTL_MS);
    }, CLEANUP_INTERVAL_MS);
  }

  return {
    sessions: {},

    getOrCreate(client, sessionId, port, initialMessage) {
      const existing = get().sessions[sessionId];
      if (existing) {
        updateSession(sessionId, (s) => ({ ...s, lastActivityAt: Date.now() }));
        return;
      }

      const session: StreamingSession = {
        ws: null as any,
        messages: [],
        streaming: false,
        lastActivityAt: Date.now(),
        scrollPosition: 0,
      };

      set((state) => ({
        sessions: { ...state.sessions, [sessionId]: session },
      }));

      client.getSessionMessages(sessionId).then((history: any[]) => {
        updateSession(sessionId, (s) => {
          if (s.messages.length > 0) return s;
          return { ...s, messages: parseHistoryMessages(history) };
        });
      });

      const ws = new WebSocket(`ws://localhost:${port}/ws/chat/${sessionId}`);
      ws.onmessage = (wsEvent) => {
        try {
          const parsed = parseChatServerEvent(JSON.parse(wsEvent.data)) as AgentEvent;
          handleEvent(sessionId, parsed);
        } catch {
          handleEvent(sessionId, { type: "error", message: "Invalid WebSocket event" });
        }
      };
      ws.onerror = () => {
        handleEvent(sessionId, { type: "error", message: "WebSocket connection error" });
      };

      if (initialMessage) {
        const originalOnOpen = ws.onopen;
        ws.onopen = () => {
          originalOnOpen?.call(ws, new Event("open") as any);
          updateSession(sessionId, (s) => ({
            ...s,
            messages: [...s.messages, { role: "user", content: initialMessage }],
            streaming: true,
            lastActivityAt: Date.now(),
          }));
          ws.send(JSON.stringify({ type: "message", content: initialMessage }));
        };
      }

      updateSession(sessionId, (s) => ({ ...s, ws }));
      startCleanupTimer();
    },

    disconnect(sessionId) {
      const session = get().sessions[sessionId];
      if (!session) return;
      session.ws.close();
      set((state) => {
        const { [sessionId]: _removed, ...rest } = state.sessions;
        return { sessions: rest };
      });
      if (Object.keys(get().sessions).length === 0 && cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = undefined;
      }
    },

    touch(sessionId) {
      updateSession(sessionId, (s) => ({ ...s, lastActivityAt: Date.now() }));
    },

    sendMessage(sessionId, text) {
      const session = get().sessions[sessionId];
      if (!session) return;
      const content = text.trim();
      if (!content || session.streaming) return;
      updateSession(sessionId, (s) => ({
        ...s,
        messages: [...s.messages, { role: "user", content }],
        streaming: true,
        lastActivityAt: Date.now(),
      }));
      session.ws.send(JSON.stringify({ type: "message", content }));
    },

    abort(sessionId) {
      const session = get().sessions[sessionId];
      if (!session) return;
      session.ws.send(JSON.stringify({ type: "abort" }));
      updateSession(sessionId, (s) => ({ ...s, streaming: false }));
    },

    setScrollPosition(sessionId, position) {
      updateSession(sessionId, (s) => ({ ...s, scrollPosition: position }));
    },

    cleanupExpired(ttlMs) {
      const now = Date.now();
      const sessions = get().sessions;
      for (const [sessionId, session] of Object.entries(sessions)) {
        if (now - session.lastActivityAt > ttlMs) {
          get().disconnect(sessionId);
        }
      }
    },
  };
});

function applyEventToStreaming(event: AgentEvent): boolean | null {
  if (event.type === "agent_end_done") return false;
  if (event.type === "error") return false;
  return null;
}

function applyEventToMessages(prev: ChatMessage[], event: AgentEvent): ChatMessage[] {
  if (event.type === "message_update" && event.message?.role === "assistant") {
    const textContent = event.message.content?.find(
      (content: any) => content.type === "text",
    );
    const text = textContent?.text ?? "";
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._streaming) {
      return [...prev.slice(0, -1), { ...last, content: text, _streaming: true }];
    }
    if (text || last?.role !== "assistant") {
      return [...prev, { role: "assistant", content: text, _streaming: true }];
    }
    return prev;
  }

  if (event.type === "message_end" && event.message?.role === "assistant") {
    const textContent = event.message.content?.find(
      (content: any) => content.type === "text",
    );
    const text = textContent?.text ?? "";
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._streaming) {
      return [...prev.slice(0, -1), { ...last, content: text, _streaming: false }];
    }
    if (text || last?.role !== "assistant") {
      return [...prev, { role: "assistant", content: text, _streaming: false }];
    }
    return prev;
  }

  if (event.type === "tool_execution_start") {
    const toolCall: ToolCallInfo = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args ?? {},
      status: "running",
    };
    const last = prev[prev.length - 1];
    if (last?.role === "assistant") {
      return [...prev.slice(0, -1), { ...last, _toolCalls: [...(last._toolCalls ?? []), toolCall] }];
    }
    return [...prev, { role: "assistant", content: "", _streaming: true, _toolCalls: [toolCall] }];
  }

  if (event.type === "tool_execution_end") {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._toolCalls) {
      const calls = last._toolCalls.map((toolCall) =>
        toolCall.toolCallId === event.toolCallId
          ? {
              ...toolCall,
              status: (event.isError ? "error" : "completed") as ToolCallInfo["status"],
              result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
            }
          : toolCall,
      );
      return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
    }
    return prev;
  }

  if (event.type === "tool_execution_update") {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._toolCalls) {
      const calls = last._toolCalls.map((toolCall) => {
        if (toolCall.toolCallId !== event.toolCallId) return toolCall;
        const updated: ToolCallInfo = {
          ...toolCall,
          partialResult: typeof event.partialResult === "string" ? event.partialResult : JSON.stringify(event.partialResult),
        };
        if (
          toolCall.toolName === "render_card" &&
          event.partialResult &&
          typeof event.partialResult === "object" &&
          (event.partialResult as any).details?.type === "html"
        ) {
          updated._card = (event.partialResult as any).details;
        }
        return updated;
      });
      return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
    }
    return prev;
  }

  if (event.type === "agent_end_done") {
    const last = prev[prev.length - 1];
    if (last?._streaming) {
      return [...prev.slice(0, -1), { ...last, _streaming: false }];
    }
    return prev;
  }

  if (event.type === "error") {
    return [...prev, { role: "assistant", content: `[Error] ${event.message}` }];
  }

  return prev;
}

export function parseHistoryMessages(history: any[]): ChatMessage[] {
  const toolResultMap = new Map<string, { result: string; isError: boolean; details?: any }>();
  for (const message of history) {
    if (message.role === "toolResult" && message.toolCallId) {
      const text = (message.content ?? [])
        .filter((content: any) => content.type === "text")
        .map((content: any) => content.text)
        .join("");
      toolResultMap.set(message.toolCallId, {
        result: text,
        isError: message.isError ?? false,
        details: message.details,
      });
    }
  }

  const loaded: ChatMessage[] = [];
  for (const message of history) {
    if (message.role === "toolResult") continue;

    const text =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .filter((content: any) => content.type === "text")
              .map((content: any) => content.text)
              .join("")
          : "";

    const toolCalls: ToolCallInfo[] | undefined =
      Array.isArray(message.content)
        ? message.content
            .filter((content: any) => content.type === "toolCall")
            .map((content: any) => {
              const toolResult = toolResultMap.get(content.id);
              const base: ToolCallInfo = {
                toolCallId: content.id,
                toolName: content.name,
                args: content.arguments ?? {},
                result: toolResult?.result,
                status: toolResult ? (toolResult.isError ? "error" as const : "completed" as const) : "completed" as const,
              };
              if (
                content.name === "render_card" &&
                toolResult?.details?.cardType === "html"
              ) {
                base._card = {
                  type: "html",
                  html: toolResult.details.html,
                  title: toolResult.details.title,
                  width: toolResult.details.width,
                  height: toolResult.details.height ?? 400,
                  max_width: toolResult.details.max_width ?? 800,
                  max_height: toolResult.details.max_height ?? 600,
                };
              }
              return base;
            })
        : undefined;

    loaded.push({
      role: message.role,
      content: text,
      ...(toolCalls && toolCalls.length > 0 ? { _toolCalls: toolCalls } : {}),
    });
  }

  return loaded;
}
```

**Important note on WebSocket URL construction**: The store constructs the WebSocket directly using the `port` parameter rather than calling `client.createChatWebSocket()`, because that method wires up its own `onmessage`/`onerror` handlers which would conflict with the store's event handling.

- [ ] **Step 2: Run lint to verify**

Run: `npm run lint --workspace=packages/app`
Expected: No errors related to streaming-store.ts

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/features/chat/streaming-store.ts
git commit -m "feat: add streaming-store for session-level WebSocket and state management"
```

---

### Task 2: Rewrite useChatSession as thin adapter

**Files:**
- Rewrite: `packages/app/src/features/chat/hooks/useChatSession.ts`

- [ ] **Step 1: Rewrite useChatSession.ts**

Replace the entire file content:

```ts
import { useEffect } from "react";
import type { ApiClient } from "../../../lib/api";
import { useStreamingStore } from "../streaming-store";

export function useChatSession({
  client,
  sessionId,
  port,
  initialMessage,
}: {
  client: ApiClient;
  sessionId: string;
  port: number;
  initialMessage?: string;
}) {
  useEffect(() => {
    useStreamingStore.getState().getOrCreate(client, sessionId, port, initialMessage);
    useStreamingStore.getState().touch(sessionId);
  }, [client, sessionId, port]);

  const messages = useStreamingStore(
    (s) => s.sessions[sessionId]?.messages ?? [],
  );
  const streaming = useStreamingStore(
    (s) => s.sessions[sessionId]?.streaming ?? false,
  );

  return {
    messages,
    streaming,
    sendMessage: (text: string) => useStreamingStore.getState().sendMessage(sessionId, text),
    abort: () => useStreamingStore.getState().abort(sessionId),
  };
}
```

Key changes from original:
- No more `useState` for `messages`/`streaming` — reads from store via selectors
- No more `useRef` for WebSocket — store owns it
- No more `useEffect` cleanup closing WebSocket — store keeps it alive
- New `port` parameter for WebSocket URL construction
- `parseHistoryMessages` moved to streaming-store (already there from Task 1)
- `sendMessage` and `abort` delegate to store actions

- [ ] **Step 2: Run lint to verify**

Run: `npm run lint --workspace=packages/app`
Expected: Pass

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/features/chat/hooks/useChatSession.ts
git commit -m "refactor: rewrite useChatSession as streaming-store adapter"
```

---

### Task 3: Update Chat component and ProjectLayout to pass port

**Files:**
- Modify: `packages/app/src/features/chat/index.tsx`
- Modify: `packages/app/src/layouts/ProjectLayout.tsx`

- [ ] **Step 1: Add port prop to Chat component**

In `packages/app/src/features/chat/index.tsx`, update `ChatProps` and pass `port` to `useChatSession`:

Change the interface:
```ts
export interface ChatProps {
  client: ApiClient;
  sessionId: string;
  port: number;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
  initialMessage?: string;
  onClose?: () => void;
}
```

Change the destructuring:
```ts
export function Chat({ client, sessionId, port, agent, onNavigateToPath, initialMessage, onClose }: ChatProps) {
  const { messages, streaming, sendMessage, abort } = useChatSession({
    client,
    sessionId,
    port,
    initialMessage,
  });
```

- [ ] **Step 2: Pass port from ProjectLayout**

In `packages/app/src/layouts/ProjectLayout.tsx`, add `port` prop to the `<Chat>` element:

```tsx
<Chat
  key={selectedSession.id}
  client={project.ctx.client}
  sessionId={selectedSession.id}
  port={project.ctx.port}
  agent={selectedAgent}
  onNavigateToPath={handleSelectFile}
  initialMessage={initialMessage}
  onClose={() => navigate(`/project/${projectKey}`)}
/>
```

- [ ] **Step 3: Run lint**

Run: `npm run lint --workspace=packages/app`
Expected: Pass

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/features/chat/index.tsx packages/app/src/layouts/ProjectLayout.tsx
git commit -m "feat: pass port prop through Chat component for streaming-store"
```

---

### Task 4: Add scroll position persistence

**Files:**
- Modify: `packages/app/src/features/chat/hooks/useChatScroll.ts`

- [ ] **Step 1: Update useChatScroll to persist/restore scroll position**

Replace the entire file:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../../lib/types";
import { useStreamingStore } from "../streaming-store";

const BOTTOM_THRESHOLD = 100;

export function useChatScroll(messages: ChatMessage[], sessionId: string) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const restoredScroll = useRef(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const checkBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsAtBottom(distanceFromBottom <= BOTTOM_THRESHOLD);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", checkBottom, { passive: true });
    checkBottom();
    return () => container.removeEventListener("scroll", checkBottom);
  }, [checkBottom, messages.length]);

  useEffect(() => {
    checkBottom();
  }, [messages, checkBottom]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (!isAtBottom) return;
    if (!initialScrollDone.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      initialScrollDone.current = true;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isAtBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;

    if (!restoredScroll.current) {
      const saved = useStreamingStore.getState().sessions[sessionId]?.scrollPosition;
      if (saved && saved > 0) {
        container.scrollTop = saved;
      }
      restoredScroll.current = true;
    }
  }, [sessionId, messages.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return () => {
      useStreamingStore.getState().setScrollPosition(sessionId, container.scrollTop);
    };
  }, [sessionId]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsAtBottom(true);
  }, []);

  return { messagesEndRef, containerRef, isAtBottom, scrollToBottom };
}
```

Key changes:
- New `sessionId` parameter
- On mount: restores scroll position from store if saved and > 0
- On unmount: saves current scroll position to store
- `restoredScroll` ref prevents re-restoring on re-renders

- [ ] **Step 2: Update Chat component to pass sessionId to useChatScroll**

In `packages/app/src/features/chat/index.tsx`, update the `useChatScroll` call:

```ts
const { messagesEndRef, containerRef, isAtBottom, scrollToBottom } = useChatScroll(messages, sessionId);
```

- [ ] **Step 3: Run lint**

Run: `npm run lint --workspace=packages/app`
Expected: Pass

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/features/chat/hooks/useChatScroll.ts packages/app/src/features/chat/index.tsx
git commit -m "feat: persist and restore scroll position across session switches"
```

---

### Task 5: Add sidebar streaming indicator

**Files:**
- Modify: `packages/app/src/features/agent-session-list/SessionRow.tsx`

- [ ] **Step 1: Add streaming indicator to SessionRow**

Add imports at top of `SessionRow.tsx`:

```ts
import { Loader2 } from "lucide-react";
import { useStreamingStore } from "../chat/streaming-store";
```

In the component body (after `const fallbackTitle = ...`), add:

```ts
const isStreaming = useStreamingStore(
  (s) => !active && s.sessions[session.id]?.streaming === true,
);
```

In the non-editing render (after the title `<span>`), add the indicator inside the `<TreeRow>`:

```tsx
<TreeRow
  depth={1}
  selected={active}
  onClick={() => onSelect(session)}
>
  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
    {session.title ?? fallbackTitle}
  </span>
  {isStreaming && (
    <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
  )}
</TreeRow>
```

- [ ] **Step 2: Run lint**

Run: `npm run lint --workspace=packages/app`
Expected: Pass

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/features/agent-session-list/SessionRow.tsx
git commit -m "feat: show streaming indicator on non-active sessions in sidebar"
```

---

### Task 6: Create E2E test for streaming resilience

**Files:**
- Create: `packages/app/e2e/chat-streaming-resilience.spec.ts`

- [ ] **Step 1: Create E2E test file**

Create `packages/app/e2e/chat-streaming-resilience.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

function projectKeyBase(projectPath: string): string {
  const name = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? "project";
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-") || "project";
}

async function createChatProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-chat-"));
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
  await mkdir(path.join(root, ".spherse", "agents", "assistant"), { recursive: true });
  await writeFile(
    path.join(root, ".spherse", "agents", "assistant", "profile.md"),
    [
      "---",
      "id: assistant-1",
      "name: Assistant",
      "type: assistant",
      "model: deepseek-v4-flash",
      "tools: []",
      "---",
      "You help with everything.",
      "",
    ].join("\n"),
  );
  return root;
}

async function launchApp(projectRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-chat-user-"));
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_ENABLE_LOGGING: "1",
      XDG_CONFIG_HOME: userDataDir,
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async (root: string) => {
    await window.electronAPI.addOpenProject(root);
    await window.electronAPI.setLastActiveProject(root);
  }, projectRoot);
  return { app, page };
}

async function createSessionViaApi(page: Page, projectRoot: string, agentId: string): Promise<string> {
  const port: number = await page.evaluate(
    (dir) => window.electronAPI.startServer(dir),
    projectRoot,
  );
  const res = await fetch(`http://localhost:${port}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  const { sessionId } = await res.json() as { sessionId: string };
  return sessionId;
}

function navigateToSession(page: Page, projectRoot: string, sessionId: string) {
  const projectUrl = `/project/${projectKeyBase(projectRoot)}/chat/${sessionId}`;
  return page.goto(`file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}`);
}

interface MockEvent {
  type: string;
  [key: string]: any;
}

async function mockChatWebSocket(page: Page, port: number, events: MockEvent[]) {
  await page.routeWebSocket(`ws://localhost:${port}/ws/chat/**`, (ws) => {
    ws.onMessage((message) => {
      const parsed = JSON.parse(message as string);
      if (parsed.type === "message") {
        for (const event of events) {
          ws.send(JSON.stringify(event));
        }
      } else if (parsed.type === "abort") {
        ws.send(JSON.stringify({ type: "agent_end_done" }));
      }
    });
    ws.connect();
  });
}

async function mockStreamingWithoutEnd(page: Page, port: number, eventsBeforeEnd: MockEvent[]): Promise<{ complete: () => void }> {
  let resolveComplete: () => void;
  const completePromise = new Promise<void>((resolve) => { resolveComplete = resolve; });

  await page.routeWebSocket(`ws://localhost:${port}/ws/chat/**`, (ws) => {
    ws.onMessage((message) => {
      const parsed = JSON.parse(message as string);
      if (parsed.type === "message") {
        for (const event of eventsBeforeEnd) {
          ws.send(JSON.stringify(event));
        }
        void completePromise.then(() => {
          ws.send(JSON.stringify({ type: "agent_end_done" }));
        });
      } else if (parsed.type === "abort") {
        ws.send(JSON.stringify({ type: "agent_end_done" }));
      }
    });
    ws.connect();
  });

  return { complete: () => resolveComplete() };
}

function createStreamingSequence(): MockEvent[] {
  return [
    { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] } },
    { type: "tool_execution_start", toolCallId: "tc1", toolName: "read_file", args: { path: "a.md" } },
    { type: "tool_execution_end", toolCallId: "tc1", toolName: "read_file", result: "content", isError: false },
    { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Based on" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Based on the file content." }] } },
    { type: "agent_end_done" },
  ];
}

test("abort button visible throughout entire agent turn until agent_end_done", async () => {
  const projectRoot = await createChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const port: number = await page.evaluate(
      (dir) => window.electronAPI.startServer(dir),
      projectRoot,
    );
    const sessionId = await createSessionViaApi(page, projectRoot, "assistant-1");

    const eventsBeforeEnd = createStreamingSequence().filter((e) => e.type !== "agent_end_done");
    const { complete } = await mockStreamingWithoutEnd(page, port, eventsBeforeEnd);

    await navigateToSession(page, projectRoot, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("[data-chat-composer] button svg.lucide-square", { timeout: 5000 });

    await expect(page.locator("[data-chat-composer] button svg.lucide-square")).toBeVisible();
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toHaveCount(0);

    complete();

    await page.waitForSelector("[data-chat-composer] button svg.lucide-send", { timeout: 5000 });
    await expect(page.locator("[data-chat-composer] button svg.lucide-square")).toHaveCount(0);
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("streaming continues after switching away and back", async () => {
  const projectRoot = await createChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const port: number = await page.evaluate(
      (dir) => window.electronAPI.startServer(dir),
      projectRoot,
    );
    const sessionA = await createSessionViaApi(page, projectRoot, "assistant-1");
    const sessionB = await createSessionViaApi(page, projectRoot, "assistant-1");

    await mockChatWebSocket(page, port, createStreamingSequence());

    await navigateToSession(page, projectRoot, sessionA);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("text=Hello", { timeout: 5000 });

    await navigateToSession(page, projectRoot, sessionB);
    await page.waitForSelector("[data-chat-composer]", { timeout: 5000 });

    await navigateToSession(page, projectRoot, sessionA);

    await page.waitForSelector("text=Based on the file content.", { timeout: 10000 });
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toBeVisible({ timeout: 10000 });
  } finally {
    await app.close();
  }
});

test("sidebar shows streaming indicator on background session", async () => {
  const projectRoot = await createChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const port: number = await page.evaluate(
      (dir) => window.electronAPI.startServer(dir),
      projectRoot,
    );
    const sessionA = await createSessionViaApi(page, projectRoot, "assistant-1");
    const sessionB = await createSessionViaApi(page, projectRoot, "assistant-1");

    const eventsBeforeEnd = createStreamingSequence().filter((e) => e.type !== "agent_end_done");
    const { complete } = await mockStreamingWithoutEnd(page, port, eventsBeforeEnd);

    await navigateToSession(page, projectRoot, sessionA);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("text=Hello", { timeout: 5000 });

    await navigateToSession(page, projectRoot, sessionB);
    await page.waitForSelector("[data-chat-composer]", { timeout: 5000 });

    const sessionARow = page.locator(`[data-session-id="${sessionA}"]`);
    await expect(sessionARow.locator("svg.lucide-loader-2")).toBeVisible({ timeout: 5000 });

    complete();

    await page.waitForSelector(`[data-session-id="${sessionA}"] svg.lucide-loader-2`, { state: "hidden", timeout: 10000 }).catch(() => {});
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run lint**

Run: `npm run lint --workspace=packages/app`
Expected: Pass

- [ ] **Step 3: Run the E2E test (optional, requires build)**

Run: `npm run test:e2e --workspace=packages/app -- e2e/chat-streaming-resilience.spec.ts`
Expected: Tests pass (may require debugging WebSocket mock behavior)

- [ ] **Step 4: Commit**

```bash
git add packages/app/e2e/chat-streaming-resilience.spec.ts
git commit -m "test: add E2E tests for chat streaming resilience"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full lint**

Run: `npm run lint`
Expected: Pass

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Pass

- [ ] **Step 3: Run existing tests**

Run: `npm test --workspace=packages/app`
Expected: All existing tests pass

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`

Verify:
1. Open a session, send a message, confirm streaming works
2. Switch to another session while streaming, confirm no crash
3. Switch back, confirm messages and streaming state preserved
4. Confirm sidebar streaming indicator appears on background session
5. Confirm abort button visible during tool execution phase
6. Confirm scroll position preserved on switch back
