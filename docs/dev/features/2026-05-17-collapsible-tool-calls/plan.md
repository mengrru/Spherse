# 折叠工具调用过程 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 agent 的 tool call 过程默认折叠，点击展开查看参数详情，同时修复事件类型不匹配的 bug 和历史消息中 tool call 数据丢失的问题。

**Architecture:** 修复前端 `AgentEvent` 类型以匹配 pi-agent-core 实际事件名，新增 `ToolCallSection` 组件处理折叠/展开 UI，修复历史消息加载逻辑以重建 `_toolCalls`。

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, pi-agent-core

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/app/src/lib/types.ts` | 更新 `ToolCallInfo` 和 `AgentEvent` 类型 |
| Create | `packages/app/src/components/ToolCallSection.tsx` | 可折叠的 tool call 列表组件 |
| Modify | `packages/app/src/pages/ChatPage.tsx` | 修复事件处理、历史加载、集成 ToolCallSection |

---

### Task 1: 更新前端类型定义

**Files:**
- Modify: `packages/app/src/lib/types.ts`

- [ ] **Step 1: 更新 `ToolCallInfo` 类型**

在 `packages/app/src/lib/types.ts` 中，将 `ToolCallInfo` 替换为：

```ts
export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  partialResult?: string;
  status: "running" | "completed" | "error";
}
```

- [ ] **Step 2: 更新 `AgentEvent` 类型**

将 `AgentEvent` 替换为：

```ts
export type AgentEvent =
  | { type: "message_update"; message: any }
  | { type: "message_end"; message: any }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
  | { type: "agent_end_done" }
  | { type: "error"; message: string };
```

---

### Task 2: 修复 ChatPage 中 handleWsEvent 的事件处理

**Files:**
- Modify: `packages/app/src/pages/ChatPage.tsx:93-183`

- [ ] **Step 1: 替换 `tool_call` 分支为 `tool_execution_start`**

将 `ChatPage.tsx` 中 `handleWsEvent` 的 `tool_call` 分支（约 line 137-153）替换为：

```tsx
} else if (event.type === "tool_execution_start") {
  const toolCall: ToolCallInfo = {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args: event.args ?? {},
    status: "running",
  };
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant") {
      return [
        ...prev.slice(0, -1),
        { ...last, _toolCalls: [...(last._toolCalls ?? []), toolCall] },
      ];
    }
    return prev;
  });
```

- [ ] **Step 2: 替换 `tool_result` 分支为 `tool_execution_end`**

将 `tool_result` 分支（约 line 154-166）替换为：

```tsx
} else if (event.type === "tool_execution_end") {
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._toolCalls) {
      const calls = last._toolCalls.map((tc) =>
        tc.toolCallId === event.toolCallId
          ? {
              ...tc,
              status: (event.isError ? "error" : "completed") as ToolCallInfo["status"],
              result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
            }
          : tc,
      );
      return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
    }
    return prev;
  });
```

- [ ] **Step 3: 添加 `tool_execution_update` 处理**

在 `tool_execution_end` 分支之后、`agent_end_done` 之前添加：

```tsx
} else if (event.type === "tool_execution_update") {
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last._toolCalls) {
      const calls = last._toolCalls.map((tc) =>
        tc.toolCallId === event.toolCallId
          ? { ...tc, partialResult: typeof event.partialResult === "string" ? event.partialResult : JSON.stringify(event.partialResult) }
          : tc,
      );
      return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
    }
    return prev;
  });
```

---

### Task 3: 修复历史消息加载逻辑

**Files:**
- Modify: `packages/app/src/pages/ChatPage.tsx:63-80`

- [ ] **Step 1: 重写历史加载逻辑**

将 `useEffect` 中的历史加载逻辑（约 line 66-79）替换为：

```tsx
client.getSessionMessages(sessionId).then((history: any[]) => {
  const toolResultMap = new Map<string, { result: string; isError: boolean }>();
  for (const m of history) {
    if (m.role === "toolResult" && m.toolCallId) {
      const text = (m.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
      toolResultMap.set(m.toolCallId, {
        result: text,
        isError: m.isError ?? false,
      });
    }
  }

  const loaded: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "toolResult") continue;

    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
          : "";

    const toolCalls: ToolCallInfo[] | undefined =
      Array.isArray(m.content)
        ? m.content
            .filter((c: any) => c.type === "toolCall")
            .map((c: any) => {
              const tr = toolResultMap.get(c.id);
              return {
                toolCallId: c.id,
                toolName: c.name,
                args: c.arguments ?? {},
                result: tr?.result,
                status: tr ? (tr.isError ? "error" as const : "completed" as const) : "completed" as const,
              };
            })
        : undefined;

    loaded.push({
      role: m.role,
      content: text,
      ...(toolCalls && toolCalls.length > 0 ? { _toolCalls: toolCalls } : {}),
    });
  }
  setMessages(loaded);
});
```

---

### Task 4: 创建 ToolCallSection 组件

**Files:**
- Create: `packages/app/src/components/ToolCallSection.tsx`

- [ ] **Step 1: 创建组件文件**

创建 `packages/app/src/components/ToolCallSection.tsx`：

```tsx
import { useState } from "react";
import type { ToolCallInfo } from "../lib/types";

interface ToolCallSectionProps {
  toolCalls: ToolCallInfo[];
}

function getArgsSummary(args: Record<string, unknown>): string {
  const priorityKeys = ["path", "name", "content", "query", "message", "text", "file"];
  for (const key of priorityKeys) {
    if (args[key] != null) {
      const val = String(args[key]);
      return val.length > 40 ? val.slice(0, 40) + "…" : val;
    }
  }
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  return keys.join(", ");
}

function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function ToolCallSection({ toolCalls }: ToolCallSectionProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="mt-2 pt-2 border-t border-dashed border-[var(--border)]">
      {toolCalls.map((tc) => {
        const expanded = expandedIds.has(tc.toolCallId);
        const summary = getArgsSummary(tc.args);
        return (
          <div key={tc.toolCallId}>
            <button
              className="flex items-center gap-1.5 text-xs py-0.5 w-full text-left hover:bg-[var(--hover)] rounded px-1 -mx-1 transition-colors"
              onClick={() => toggle(tc.toolCallId)}
            >
              <span className="text-[10px] text-[var(--secondary)] select-none w-3 inline-block text-center">
                {expanded ? "▾" : "▸"}
              </span>
              <span className="font-mono bg-[var(--code-bg)] px-1 py-[1px] rounded-[2px]">
                {tc.toolName}
              </span>
              {summary && (
                <span className="text-[var(--secondary)] truncate max-w-[200px]">
                  → {summary}
                </span>
              )}
              <span className="ml-auto shrink-0">
                {tc.status === "running" && <span className="text-accent">...</span>}
                {tc.status === "completed" && <span className="text-success">✓</span>}
                {tc.status === "error" && <span className="text-danger">✗</span>}
              </span>
            </button>
            {expanded && (
              <div className="ml-4 mb-1.5 mt-0.5 text-xs">
                <table className="border-collapse">
                  <tbody>
                    {Object.entries(tc.args).map(([key, value]) => (
                      <tr key={key}>
                        <td className="py-0.5 pr-3 font-mono text-[var(--secondary)] align-top whitespace-nowrap">
                          {key}
                        </td>
                        <td className="py-0.5">
                          <code className="bg-[var(--code-bg)] px-1 py-[1px] rounded-[2px] break-all whitespace-pre-wrap">
                            {formatArgValue(value)}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

---

### Task 5: 集成 ToolCallSection 到 ChatPage

**Files:**
- Modify: `packages/app/src/pages/ChatPage.tsx`

- [ ] **Step 1: 添加 import**

在 `ChatPage.tsx` 顶部 import 区域添加：

```ts
import { ToolCallSection } from "../components/ToolCallSection";
```

- [ ] **Step 2: 替换内联 tool call 渲染**

将 `ChatPage.tsx` 中的内联 tool call 渲染代码（约 line 229-240）：

```tsx
{msg._toolCalls && msg._toolCalls.length > 0 && (
  <div className="mt-2 pt-2 border-t border-dashed border-[var(--border)]">
    {msg._toolCalls.map((tc, j) => (
      <div key={j} className={`flex items-center gap-1.5 text-xs py-0.5`}>
        <span className="font-mono bg-[var(--code-bg)] px-1 py-[1px] rounded-[2px]">{tc.toolName}</span>
        <span className={tc.status === "running" ? "text-accent" : "text-success"}>
          {tc.status === "running" ? "..." : "done"}
        </span>
      </div>
    ))}
  </div>
)}
```

替换为：

```tsx
{msg._toolCalls && msg._toolCalls.length > 0 && (
  <ToolCallSection toolCalls={msg._toolCalls} />
)}
```

- [ ] **Step 3: 从 import 中移除未使用的类型**

`ToolCallInfo` 仍在 `handleWsEvent` 中使用，保留。无需移除。

---

### Task 6: 验证

- [ ] **Step 1: 构建检查**

Run: `npm run build`
Expected: 编译通过，无 TypeScript 错误

- [ ] **Step 2: 启动应用手动验证**

Run: `npm run dev`

验证：
1. 打开一个有 tool call 的会话，确认 tool call 以折叠状态显示
2. 发送一条触发 tool call 的消息，确认 streaming 时实时显示 tool call（折叠态，显示工具名 + 参数摘要）
3. 点击 tool call 行，确认展开后显示参数 key-value 表格
4. 刷新页面，确认历史 tool call 数据正确加载并保持一致渲染
5. 确认 `toolResult` 角色的消息不作为独立消息气泡显示
