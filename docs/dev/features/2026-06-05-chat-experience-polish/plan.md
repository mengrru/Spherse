# Chat 体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 Chat 界面的 5 个体验缺陷：输入缓存、消息复制、空状态引导、智能滚动、发送后聚焦。

**Architecture:** 5 个独立子项，全部为纯前端改动，不涉及 server/core 层。输入缓存使用 localStorage，智能滚动改造现有 hook，其余为组件内小幅修改。

**Tech Stack:** React, TypeScript, Tailwind CSS v4, lucide-react icons, Zustand (已有 stores)

**Design doc:** `docs/dev/features/2026-06-05-chat-experience-polish/design.md`

---

### Task 1: 发送后自动聚焦

发送消息后 textarea 会在 streaming 期间禁用，因此需要在 streaming 结束后重新聚焦。

**Files:**
- Modify: `packages/app/src/features/chat/Composer.tsx:49`

- [ ] **Step 1: 在 streaming 结束后添加 focus 调用**

在 `send()` 后添加 effect：

```tsx
useEffect(() => {
  if (!streaming) textareaRef.current?.focus();
}, [streaming]);
```

- [ ] **Step 2: 验证**

启动 dev 应用，发送一条消息，确认 textarea 自动获得焦点且可以立即输入。

---

### Task 2: Composer 输入缓存

为 Composer 添加 localStorage 持久化。需要从父组件传入 `sessionId`。

**Files:**
- Modify: `packages/app/src/features/chat/Composer.tsx`
- Modify: `packages/app/src/features/chat/index.tsx`

- [ ] **Step 1: Composer 接收 sessionId prop**

`Composer.tsx` — 修改 Props 接口：

```tsx
interface ComposerProps {
  streaming: boolean;
  sessionId: string;
  onSend: (message: string) => void;
  onAbort: () => void;
}

export function Composer({ streaming, sessionId, onSend, onAbort }: ComposerProps) {
```

- [ ] **Step 2: 添加 localStorage 读写逻辑**

在 `Composer` 函数内添加 draft 管理：

```tsx
const draftKey = `spherse:draft:${sessionId}`;

const [input, setInput] = useState(() => localStorage.getItem(draftKey) ?? "");
```

替换原有的 `useState("")`。

- [ ] **Step 3: 添加 debounce 写入**

在 `useLayoutEffect` 的 import 中添加 `useEffect`，并添加：

```tsx
useEffect(() => {
  if (input) {
    const timer = setTimeout(() => localStorage.setItem(draftKey, input), 300);
    return () => clearTimeout(timer);
  } else {
    localStorage.removeItem(draftKey);
  }
}, [input, draftKey]);
```

- [ ] **Step 4: 组件卸载时立即保存**

```tsx
useEffect(() => {
  return () => {
    const current = input;
    if (current) {
      localStorage.setItem(`spherse:draft:${sessionId}`, current);
    }
  };
}, []);
```

- [ ] **Step 5: 发送后清除缓存**

在 `send()` 函数中，`setInput("")` 之后添加：

```tsx
localStorage.removeItem(draftKey);
```

- [ ] **Step 6: Chat 传递 sessionId**

`index.tsx` — 修改 Composer 调用：

```tsx
<Composer
  streaming={streaming}
  sessionId={sessionId}
  onSend={sendMessage}
  onAbort={abort}
/>
```

- [ ] **Step 7: 验证**

启动 dev 应用：
1. 在 session A 输入一半内容，切到 session B，切回 A — 确认内容恢复
2. 发送消息 — 确认缓存被清除
3. 输入内容后关闭应用，重新打开 — 确认内容恢复

---

### Task 3: 消息复制按钮

在 MessageItem 上添加悬停显示的复制按钮。

**Files:**
- Create: `packages/app/src/features/chat/CopyButton.tsx`
- Modify: `packages/app/src/features/chat/MessageItem.tsx`

- [ ] **Step 1: 创建 CopyButton 组件**

```tsx
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { CheckIcon, CopyIcon } from "lucide-react";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
      onClick={handleCopy}
      title="复制"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
```

- [ ] **Step 2: 在 MessageItem 中并排显示复制按钮**

```tsx
import { CopyButton } from "./CopyButton";

const isUser = message.role === "user";

<div className={`group max-w-[80%] flex items-end gap-1.5 ${isUser ? "self-end flex-row-reverse" : "self-start"}`}>
  <div
    className={`rounded-lg px-3.5 py-2.5 leading-7 break-words ${
      isUser
        ? "bg-primary text-primary-foreground"
        : "border border-border bg-card text-card-foreground"
    }`}
  >
    message content
  </div>
{!message._streaming && (
  <div className="opacity-0 group-hover:opacity-100 transition-opacity pb-1">
    <CopyButton text={message.content} />
  </div>
)}
</div>
```

- [ ] **Step 5: 验证**

启动 dev 应用：
1. 悬停 assistant 消息 — 按钮出现在气泡右侧
2. 悬停 user 消息 — 按钮出现在气泡左侧
3. 点击复制 — 图标变为 ✓，2 秒后恢复
4. 粘贴验证复制的是原始 Markdown
5. 流式输出中 — 无复制按钮

---

### Task 4: 空状态引导

**Files:**
- Modify: `packages/app/src/features/chat/MessageList.tsx`

- [ ] **Step 1: 添加空状态渲染**

在 `messages.map` 之前添加条件渲染：

```tsx
export function MessageList({ messages, agent, messagesEndRef, onNavigateToPath }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
        <div className="text-muted-foreground text-sm font-medium">{agent.name}</div>
        <div className="text-muted-foreground text-sm">发送一条消息开始对话</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {messages.map((message, index) => (
        <MessageItem
          key={index}
          message={message}
          agent={agent}
          onNavigateToPath={onNavigateToPath}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}
```

- [ ] **Step 2: 验证**

启动 dev 应用，新建一个 session — 确认显示 agent 名称 + 提示文字，发送消息后消失。

---

### Task 5: 智能滚动锁定

改造 `useChatScroll`，添加底部检测和"回到底部"按钮。

**Files:**
- Modify: `packages/app/src/features/chat/hooks/useChatScroll.ts`
- Modify: `packages/app/src/features/chat/MessageList.tsx`
- Modify: `packages/app/src/features/chat/index.tsx`

- [ ] **Step 1: 改造 useChatScroll hook**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../../lib/types";

const BOTTOM_THRESHOLD = 100;

export function useChatScroll(messages: ChatMessage[]) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
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
    return () => container.removeEventListener("scroll", checkBottom);
  }, [checkBottom]);

  useEffect(() => {
    if (!isAtBottom) return;
    if (!initialScrollDone.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      if (messages.length > 0) initialScrollDone.current = true;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isAtBottom]);

  useEffect(() => {
    initialScrollDone.current = false;
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return { messagesEndRef, containerRef, isAtBottom, scrollToBottom };
}
```

- [ ] **Step 2: Chat 传递新的 ref 和状态**

`index.tsx` — 修改 hook 解构和 MessageList props：

```tsx
const { messagesEndRef, containerRef, isAtBottom, scrollToBottom } = useChatScroll(messages);

return (
  <div className="flex flex-col h-full">
    <Header agent={agent} />
    <MessageList
      messages={messages}
      agent={agent}
      messagesEndRef={messagesEndRef}
      containerRef={containerRef}
      isAtBottom={isAtBottom}
      onScrollToBottom={scrollToBottom}
      onNavigateToPath={onNavigateToPath}
    />
    <Composer
      streaming={streaming}
      sessionId={sessionId}
      onSend={sendMessage}
      onAbort={abort}
    />
  </div>
);
```

- [ ] **Step 3: MessageList 接收新 props 并渲染回到底部按钮**

更新 Props 接口和渲染：

```tsx
interface MessageListProps {
  messages: ChatMessage[];
  agent: AgentProfile;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  onScrollToBottom: () => void;
  onNavigateToPath?: (path: string) => void;
}
```

使用外层 `relative flex-1 min-h-0` wrapper 包裹滚动容器，`containerRef` 绑定到内部滚动 div；回到底部按钮作为 wrapper 的 overlay 渲染：

```tsx
{!isAtBottom && (
  <div className="absolute bottom-4 right-4">
    <Button
      variant="outline"
      size="icon-lg"
      className="rounded-full bg-background shadow-md"
      onClick={onScrollToBottom}
    >
      <ChevronDownIcon />
    </Button>
  </div>
)}
```

需要 import `ChevronDownIcon`，并确保按钮不参与滚动内容高度。

- [ ] **Step 4: 验证**

启动 dev 应用：
1. 正常对话 — 新消息自动滚动到底部
2. 向上滚动浏览历史 — 流式输出不再强制拉回底部
3. 出现"回到底部"浮动按钮
4. 点击按钮 — 平滑滚回底部
5. 滚回底部后 — 按钮消失，自动滚动恢复
