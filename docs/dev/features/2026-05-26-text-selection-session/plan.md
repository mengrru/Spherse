# 划取文本发起会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ContentBrowser 中支持划取文本，通过浮动工具栏和内联评论框向指定 Agent 发起会话。

**Architecture:** 纯前端实现，新增两个组件（TextSelectionToolbar、SelectionSessionDialog），修改三个现有页面组件（ContentBrowser、ChatPage、ProjectPage）。不涉及后端改动，使用现有 `POST /api/sessions` + WebSocket 协议。

**Tech Stack:** React + TypeScript，Tailwind CSS v4 + CSS 变量色彩体系

**Design Doc:** `docs/dev/features/2026-05-26-text-selection-session/design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/app/src/components/TextSelectionToolbar.tsx` | 选区上方浮动工具栏按钮 |
| Create | `packages/app/src/components/SelectionSessionDialog.tsx` | 内联评论框 + Agent 选择器（两阶段） |
| Modify | `packages/app/src/pages/ContentBrowser.tsx` | 集成文本选区检测、工具栏、评论框 |
| Modify | `packages/app/src/pages/ChatPage.tsx` | 支持 `initialMessage` prop，WS 连接后自动发送 |
| Modify | `packages/app/src/pages/ProjectPage.tsx` | 传递 agents + 回调，编排会话创建+导航 |

---

### Task 1: TextSelectionToolbar 组件

**Files:**
- Create: `packages/app/src/components/TextSelectionToolbar.tsx`

- [ ] **Step 1: 创建 TextSelectionToolbar 组件**

```tsx
import { useEffect, useRef } from "react";

interface TextSelectionToolbarProps {
  position: { x: number; y: number }
  onAction: () => void
  onClose: () => void
}

export function TextSelectionToolbar({ position, onAction, onClose }: TextSelectionToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 px-2 cursor-pointer text-[12px] hover:bg-[var(--hover)] transition-colors"
      style={{
        left: position.x,
        top: position.y,
        transform: "translateX(-50%)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onAction}
    >
      💬 发起会话
    </div>
  );
}
```

- [ ] **Step 2: 验证文件无语法错误**

Run: `npx tsc --noEmit --project packages/app/tsconfig.json 2>&1 | head -20`

确认新文件没有类型错误（可能因为未导入而暂时无报错）。

---

### Task 2: SelectionSessionDialog 组件

**Files:**
- Create: `packages/app/src/components/SelectionSessionDialog.tsx`

- [ ] **Step 1: 创建 SelectionSessionDialog 组件**

```tsx
import { useState, useEffect, useRef } from "react";
import type { AgentProfile } from "../lib/types";

interface SelectionSessionDialogProps {
  selectedText: string
  sourcePath: string
  agents: AgentProfile[]
  position: { x: number; y: number }
  onSubmit: (agentId: string, comment?: string) => void
  onClose: () => void
}

const MAX_PREVIEW_LENGTH = 200;

export function SelectionSessionDialog({
  selectedText,
  sourcePath,
  agents,
  position,
  onSubmit,
  onClose,
}: SelectionSessionDialogProps) {
  const [phase, setPhase] = useState<"compose" | "select-agent">("compose");
  const [comment, setComment] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const previewText =
    selectedText.length > MAX_PREVIEW_LENGTH
      ? selectedText.slice(0, MAX_PREVIEW_LENGTH) + "..."
      : selectedText;

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface border border-[var(--border)] rounded-lg shadow-xl"
      style={{
        left: Math.max(8, Math.min(position.x - 100, window.innerWidth - 420)),
        top: Math.max(8, position.y),
        maxWidth: 400,
        width: "max-content",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-3">
        <div className="text-[11px] text-[var(--secondary)] mb-2">
          引用自 <span className="font-mono">{sourcePath}</span>
        </div>
        <div className="border-l-3 border-[var(--accent)] bg-[var(--muted-bg)] rounded-r p-2 text-[12px] font-mono max-h-[80px] overflow-y-auto mb-2 leading-relaxed">
          {previewText}
        </div>

        {phase === "compose" ? (
          <>
            <textarea
              className="w-full h-[48px] p-2 text-[13px] bg-[var(--input-bg)] border border-[var(--border-input)] rounded resize-y box-border outline-none focus:border-accent"
              placeholder="添加补充说明（可选）..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="flex justify-end mt-2">
              <button
                className="px-3 py-1.5 text-[12px] bg-accent text-white rounded hover:bg-accent-hover transition-colors"
                onClick={() => setPhase("select-agent")}
              >
                发送 ➤
              </button>
            </div>
          </>
        ) : (
          <div className="mt-1 border-t border-[var(--border)] pt-2">
            <div className="text-[11px] text-[var(--secondary)] mb-1">选择 Agent</div>
            <div className="flex flex-col gap-0.5">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  className="w-full px-2 py-1.5 text-left text-[13px] rounded hover:bg-[var(--hover)] transition-colors flex justify-between items-center"
                  onClick={() => onSubmit(agent.id, comment || undefined)}
                >
                  <span>{agent.name}</span>
                  <span className="text-[11px] text-[var(--secondary)]">发送</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证文件无语法错误**

Run: `npx tsc --noEmit --project packages/app/tsconfig.json 2>&1 | head -20`

---

### Task 3: ChatPage 支持 initialMessage

**Files:**
- Modify: `packages/app/src/pages/ChatPage.tsx`

ChatPage 需要支持 `initialMessage` prop，在 WebSocket 连接建立后自动发送初始消息。需要在 `createChatWebSocket` 返回的 WS 对象上链式处理 `onopen`。

- [ ] **Step 1: 修改 ChatPageProps 接口，添加 initialMessage**

在 `ChatPage.tsx` 的 `ChatPageProps` 接口（第 15-20 行）中添加 `initialMessage`:

当前代码：
```tsx
interface ChatPageProps {
  client: ApiClient;
  sessionId: string;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
}
```

改为：
```tsx
interface ChatPageProps {
  client: ApiClient;
  sessionId: string;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
  initialMessage?: string;
}
```

- [ ] **Step 2: 解构 initialMessage 并添加 ref**

在函数签名（第 22 行）中添加 `initialMessage`：

当前代码：
```tsx
export function ChatPage({ client, sessionId, agent, onNavigateToPath }: ChatPageProps) {
```

改为：
```tsx
export function ChatPage({ client, sessionId, agent, onNavigateToPath, initialMessage }: ChatPageProps) {
```

在 `messagesEndRef` 声明之后（第 30 行附近）添加：
```tsx
const initialMessageRef = useRef(initialMessage);
```

- [ ] **Step 3: 在 WS 连接建立后发送 initialMessage**

在 `useEffect` 中（第 66-148 行，依赖 `[sessionId]`），找到 WS 创建后的位置。当前代码（第 139-148 行）：

```tsx
    const ws = client.createChatWebSocket(sessionId, (event: AgentEvent) => {
      handleWsEvent(event);
    });
    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);
```

改为：

```tsx
    const ws = client.createChatWebSocket(sessionId, (event: AgentEvent) => {
      handleWsEvent(event);
    });
    wsRef.current = ws;

    if (initialMessageRef.current) {
      const msg = initialMessageRef.current;
      const origOnOpen = ws.onopen;
      ws.onopen = () => {
        origOnOpen?.call(ws, new Event("open") as any);
        setMessages((prev) => [...prev, { role: "user", content: msg }]);
        ws.send(JSON.stringify({ type: "message", content: msg }));
        setStreaming(true);
        initialMessageRef.current = undefined;
      };
    }

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);
```

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit --project packages/app/tsconfig.json 2>&1 | head -20`

---

### Task 4: ContentBrowser 集成文本选区检测

**Files:**
- Modify: `packages/app/src/pages/ContentBrowser.tsx`

在 ContentBrowser 中添加文本选区检测、浮动工具栏和评论框的集成逻辑。

- [ ] **Step 1: 添加 imports 和新 props**

在文件顶部的 imports（第 1-4 行）中，将：

```tsx
import { useState, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApiClient } from "../lib/api";
```

改为：

```tsx
import { useState, useEffect, useCallback, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApiClient } from "../lib/api";
import type { AgentProfile } from "../lib/types";
import { TextSelectionToolbar } from "../components/TextSelectionToolbar";
import { SelectionSessionDialog } from "../components/SelectionSessionDialog";
```

将 `ContentBrowserProps` 接口（第 6-10 行）从：

```tsx
interface ContentBrowserProps {
  client: ApiClient;
  filePath: string;
  onBack: () => void;
}
```

改为：

```tsx
interface ContentBrowserProps {
  client: ApiClient;
  filePath: string;
  onBack: () => void;
  agents: AgentProfile[];
  onStartSession?: (agentId: string, selectedText: string, sourcePath: string, comment?: string) => void;
}
```

将函数签名（第 12 行）从：

```tsx
export function ContentBrowser({ client, filePath, onBack }: ContentBrowserProps) {
```

改为：

```tsx
export function ContentBrowser({ client, filePath, onBack, agents, onStartSession }: ContentBrowserProps) {
```

- [ ] **Step 2: 添加选区检测状态和 ref**

在现有 state 声明之后（第 24 行 `showCancelConfirm` 之后），添加：

```tsx
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectionState, setSelectionState] = useState<{
    text: string;
    position: { x: number; y: number };
  } | null>(null);
  const [showSessionDialog, setShowSessionDialog] = useState(false);
```

- [ ] **Step 3: 添加文本选区检测 useEffect**

在 `handleSave` 的 `useEffect`（第 108-118 行，监听 Cmd+S 的那个）之后，添加：

```tsx
  useEffect(() => {
    if (isEditing || showSessionDialog) return;

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionState(null);
        return;
      }

      const contentEl = contentRef.current;
      if (!contentEl) return;

      const range = selection.getRangeAt(0);
      if (!contentEl.contains(range.commonAncestorContainer)) return;

      const text = selection.toString().trim();
      const rect = range.getBoundingClientRect();
      const y = rect.top > 50 ? rect.top - 36 : rect.bottom + 4;

      setSelectionState({
        text,
        position: { x: rect.left + rect.width / 2, y },
      });
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [isEditing, showSessionDialog]);
```

- [ ] **Step 4: 给内容显示区域添加 ref**

找到文件内容渲染区域的 `<div className="flex-1 overflow-y-auto p-4">`（第 229 行），改为：

```tsx
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
```

- [ ] **Step 5: 在组件末尾渲染工具栏和评论框**

在组件 `return` 的 `</div>` 结束标签之前（即第 285 行之前，最外层 div 的闭合标签之前），添加：

```tsx
      {selectionState && !showSessionDialog && (
        <TextSelectionToolbar
          position={selectionState.position}
          onAction={() => setShowSessionDialog(true)}
          onClose={() => setSelectionState(null)}
        />
      )}
      {showSessionDialog && selectionState && (
        <SelectionSessionDialog
          selectedText={selectionState.text}
          sourcePath={filePath}
          agents={agents}
          position={selectionState.position}
          onSubmit={(agentId, comment) => {
            onStartSession?.(agentId, selectionState.text, filePath, comment);
            setShowSessionDialog(false);
            setSelectionState(null);
          }}
          onClose={() => {
            setShowSessionDialog(false);
            setSelectionState(null);
          }}
        />
      )}
```

- [ ] **Step 6: 验证编译通过**

Run: `npx tsc --noEmit --project packages/app/tsconfig.json 2>&1 | head -20`

---

### Task 5: ProjectPage 编排会话创建与导航

**Files:**
- Modify: `packages/app/src/pages/ProjectPage.tsx`

ProjectPage 需要将 agents 列表和 `onStartSession` 回调传递给 ContentBrowser，并在回调中处理会话创建、消息构建和页面导航。

- [ ] **Step 1: 添加 initialMessage state**

在现有 state 声明中（第 27 行 `showSettings` 之后），添加：

```tsx
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);
```

- [ ] **Step 2: 添加 handleStartSession 回调**

在 `handleBackToChat` 函数（第 126-128 行）之后，添加：

```tsx
  const handleStartSession = async (
    agentId: string,
    selectedText: string,
    sourcePath: string,
    comment?: string,
  ) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    const parts = [`请处理以下来自「${sourcePath}」的内容：\n\n> ${selectedText}`];
    if (comment) parts.push(`\n\n${comment}`);
    const message = parts.join("");

    const { sessionId: sid } = await ctx.client.createSession(agentId);
    refreshSessions();

    const newSession: SessionInfo = {
      id: sid,
      agentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "active",
    };

    setInitialMessage(message);
    setSelectedSession(newSession);
    setSelectedAgent(agent);
    setViewMode("chat");
  };
```

- [ ] **Step 2b: 清除 stale initialMessage**

为防止过期 `initialMessage` 被普通新建或选择会话时误发送，在以下两个函数开头添加 `setInitialMessage(undefined)`：

`handleNewSession`（当前代码第 95-109 行），在 `setMenuAgentId(null)` 之后添加：

```tsx
  const handleNewSession = async (agent: AgentProfile) => {
    setMenuAgentId(null);
    setInitialMessage(undefined);
    // ... 其余不变
  };
```

`handleSelectSession`（当前代码第 87-93 行），在 `if (!agent) return` 之前添加：

```tsx
  const handleSelectSession = (session: SessionInfo) => {
    setInitialMessage(undefined);
    const agent = agents.find((a) => a.id === session.agentId);
    // ... 其余不变
  };
```

- [ ] **Step 3: 传递 agents 和 onStartSession 给 ContentBrowser**

找到 ContentBrowser 的渲染（第 300-306 行），当前代码：

```tsx
        {viewMode === "content" && selectedFile && (
          <ContentBrowser
            client={ctx.client}
            filePath={selectedFile}
            onBack={handleBackToChat}
          />
        )}
```

改为：

```tsx
        {viewMode === "content" && selectedFile && (
          <ContentBrowser
            client={ctx.client}
            filePath={selectedFile}
            onBack={handleBackToChat}
            agents={agents}
            onStartSession={handleStartSession}
          />
        )}
```

- [ ] **Step 4: 传递 initialMessage 给 ChatPage**

找到 ChatPage 的渲染（第 294-297 行），当前代码：

```tsx
          <div className={viewMode === "chat" ? "contents" : "hidden"}>
            <ChatPage client={ctx.client} sessionId={selectedSession.id} agent={selectedAgent} onNavigateToPath={handleSelectFile} />
          </div>
```

改为：

```tsx
          <div className={viewMode === "chat" ? "contents" : "hidden"}>
            <ChatPage client={ctx.client} sessionId={selectedSession.id} agent={selectedAgent} onNavigateToPath={handleSelectFile} initialMessage={initialMessage} />
          </div>
```

- [ ] **Step 5: 验证编译通过**

Run: `npx tsc --noEmit --project packages/app/tsconfig.json 2>&1 | head -20`

Expected: 无错误输出

---

### Task 6: 端到端手动验证

此 feature 为纯前端改动，无自动化测试。需手动验证完整流程。

- [ ] **Step 1: 启动开发环境**

```bash
npm run dev --workspace=packages/core &
npm run dev --workspace=packages/server &
npm run dev
```

- [ ] **Step 2: 验证浮动工具栏**

1. 打开一个项目，在文件树中点击一个 `.md` 或 `.txt` 文件
2. 在内容预览区用鼠标划取一段文本
3. 确认选区上方出现 "💬 发起会话" 浮动按钮
4. 点击页面空白处，确认工具栏消失
5. 按 Escape，确认工具栏消失

- [ ] **Step 3: 验证评论框**

1. 再次划取文本，点击浮动工具栏
2. 确认弹出评论框，显示引用来源和选中文本
3. 输入补充说明
4. 点击"发送 ➤"
5. 确认 Agent 列表展开
6. 按 Escape 或点击外部，确认评论框关闭

- [ ] **Step 4: 验证会话创建**

1. 划取文本 → 点击工具栏 → 输入补充说明 → 点击发送 → 选择一个 Agent
2. 确认自动跳转到聊天页面
3. 确认聊天页面显示用户消息（结构化格式）
4. 确认 Agent 开始回复

- [ ] **Step 5: 验证边界情况**

1. 在 HTML 预览模式下划取文本 — 工具栏不应出现
2. 在编辑模式下划取文本 — 工具栏不应出现
3. 选区靠近视口顶部 — 工具栏应显示在选区下方
4. 没有选中文本时点击空白 — 不应出现工具栏
