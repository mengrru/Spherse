# Chat Streaming Resilience

## 背景

当前 chat 功能的 session 切换机制使用 `<Chat key={sessionId}>` 强制组件 remount。这导致切换 session 时 WebSocket 关闭、streaming 状态丢失。后端 `engine.sendMessage()` 会继续执行完毕并将结果持久化到 SQLite，所以切回 session 后能看到最终结果，但中间的 streaming 过程不可见。

## 目标

1. 切出 session（切换到其他 session）再切回时，streaming 工作状态不被打断——继续渲染 streaming 内容
2. 后台 streaming session 有过期机制，超过一定时间后释放资源
3. 侧边栏显示后台 streaming session 的状态指示器

## 方案概述

采用 **Streaming Session Store**（Zustand）方案：将 WebSocket 连接和 streaming 状态从组件生命周期中提取出来，按 `sessionId` 在 store 中维护。组件切换 session 时只是切换数据源，后台 session 的 WebSocket 保持存活。

## 详细设计

### 1. Streaming Session Store

**新文件**：`packages/app/src/features/chat/streaming-store.ts`

**数据结构**：

```ts
interface StreamingSession {
  ws: WebSocket;
  messages: ChatMessage[];
  streaming: boolean;
  lastActivityAt: number;
}

interface StreamingStore {
  sessions: Record<string, StreamingSession>;
  getOrCreate: (client: ApiClient, sessionId: string, initialMessage?: string) => StreamingSession;
  disconnect: (sessionId: string) => void;
  touch: (sessionId: string) => void;
  sendMessage: (sessionId: string, text: string) => void;
  abort: (sessionId: string) => void;
  cleanupExpired: (ttlMs: number) => void;
}
```

**WebSocket 事件处理逻辑**：将 `useChatSession` 中 `handleWsEvent` 的全部逻辑搬到 store 内，直接更新对应 `StreamingSession` 的 `messages` 和 `streaming` 字段。涵盖的事件类型：

- `message_update` — 更新/追加 streaming 中的 assistant 消息
- `message_end` — 完成 assistant 消息（标记 `_streaming = false`），**不改变** `streaming` 标记（agent turn 可能未结束，后续还有 tool call 或下一轮 LLM 调用）
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` — 更新 tool call 状态
- `agent_end_done` — 设 `streaming = false`（整个 agent turn 结束，Composer 显示发送键）
- `error` — 追加错误消息，设 `streaming = false`

**行为变更**：`streaming` 仅在 `agent_end_done` 和 `error` 时置为 false（当前实现在 `message_end` 时就置 false）。这确保在整个 agent turn 期间 Composer 始终显示停止键，包括 tool call 阶段。切出再切回时，`streaming` 布尔值正确反映 turn 是否仍在进行。

**`getOrCreate` 逻辑**：

1. 检查 `sessions[sessionId]` 是否存在
2. 存在 → 更新 `lastActivityAt`，返回现有 session
3. 不存在 →
   - 创建 WebSocket 连接（复用 `client.createChatWebSocket` 的 URL 和解析逻辑）
   - Fetch history（`client.getSessionMessages`），用 `parseHistoryMessages` 解析为 `ChatMessage[]`
   - 仅在首次创建时：如有 `initialMessage`，在 `ws.onopen` 中发送并设 `streaming = true`（`initialMessage` 不会被重复消费）
   - 将事件处理绑定到 store 的更新方法
   - 存入 `sessions` 并返回

### 2. useChatSession 重构

**变更文件**：`packages/app/src/features/chat/hooks/useChatSession.ts`

重构为 streaming store 的薄适配层：

```ts
function useChatSession({ client, sessionId, initialMessage }) {
  useEffect(() => {
    streamingStore.getOrCreate(client, sessionId, initialMessage);
    streamingStore.touch(sessionId);
  }, [client, sessionId]);

  const messages = useStreamingStore(
    (s) => s.sessions[sessionId]?.messages ?? []
  );
  const streaming = useStreamingStore(
    (s) => s.sessions[sessionId]?.streaming ?? false
  );

  return {
    messages,
    streaming,
    sendMessage: (text) => streamingStore.sendMessage(sessionId, text),
    abort: () => streamingStore.abort(sessionId),
  };
}
```

**关键变化**：
- 不再在 `useEffect` cleanup 中关闭 WebSocket
- 状态来源从 `useState` 改为 Zustand selector
- `parseHistoryMessages` 函数移入 streaming-store（供 `getOrCreate` 使用）

### 3. 过期清理机制

**TTL**：默认 5 分钟（300,000ms）。

**清理逻辑**：
- 每次 `sendMessage` 或收到 WebSocket 事件时自动更新 `lastActivityAt`
- `cleanupExpired(ttlMs)` 遍历所有 session，`Date.now() - lastActivityAt > ttlMs` 则 `disconnect`
- `disconnect` 关闭 WebSocket + 从 `sessions` 中移除

**清理触发**：使用 `setInterval`（每 30 秒）在 store 初始化时启动，检查并清理过期 session。interval 在 store 被销毁时清除。

**过期后切回**：
- store 中无该 session → `getOrCreate` 创建新连接 + fetch history
- 如果后端 streaming 已完成，用户看到完整历史消息（与当前行为一致）
- 如果后端仍在 streaming（长任务），新 WebSocket 连接后无法恢复中间状态，但 `restoreSession` 是幂等的，后续事件会正常发送

### 4. 侧边栏 Streaming 指示器

**变更文件**：`packages/app/src/features/agent-session-list/SessionRow.tsx`

- 从 `streaming-store` 读取 `sessions[session.id]?.streaming`
- 当 session 非 active（未被选中）且 streaming 为 true 时，在标题右侧显示旋转动画图标（`Loader2` from lucide）
- active session 不显示指示器（chat 区域已有 streaming 表现）

### 5. Scroll 位置保持

**变更文件**：
- `streaming-store.ts` — `StreamingSession` 增加 `scrollPosition: number` 字段
- `packages/app/src/features/chat/hooks/useChatScroll.ts` — 组件 unmount 时将 scroll position 写入 store，mount 时恢复

### 不变的部分

- **`ProjectLayout.tsx`**：`<Chat key={sessionId}>` 保持不变，组件仍会 remount，但状态从 store 恢复
- **`Composer.tsx`**：draft 保持机制（localStorage）不受影响
- **`ws-chat.ts`**（后端）：无需改动。`restoreSession` 是幂等的，多次 WebSocket 连接同一 session 无副作用
- **`engine.ts`**（core）：无需改动。Agent 实例在 `activeSessions` 中持续存在

### 6. E2E 测试

**新文件**：`packages/app/e2e/chat-streaming-resilience.spec.ts`

**Mock 策略**：使用 Playwright 的 `page.routeWebSocket()` 拦截 WebSocket 连接，模拟 server 端按时间线推送 scripted 事件序列。不依赖真实 LLM provider。

**测试用例**：

1. **切出再切回 streaming 继续渲染**
   - 创建两个 session（A 和 B）
   - 向 A 发送消息，mock server 开始推送 `message_update` 事件
   - 切换到 session B
   - 切回 session A
   - 验证：streaming 内容继续渲染（assistant 消息中包含之前和之后的事件内容）

2. **切出期间 streaming 完成，切回显示完整结果**
   - 向 session A 发送消息，mock 推送若干事件后发送 `agent_end_done`
   - 切到 B，再切回 A
   - 验证：显示完整 assistant 消息，Composer 显示发送键（非停止键）

3. **整个 agent turn 期间停止键始终可见**
   - 向 session 发送消息
   - mock 推送 `message_update` → `message_end`（单条 assistant 消息结束）→ `tool_execution_start`
   - 验证：`message_end` 之后 Composer 仍显示停止键
   - 继续推送 `tool_execution_end` → `message_update`（第二轮）→ `agent_end_done`
   - 验证：`agent_end_done` 后 Composer 切换为发送键

4. **侧边栏 streaming 指示器**
   - 向 session A 发送消息，mock 开始 streaming
   - 切到 session B
   - 验证：session A 在侧边栏显示 streaming 指示器（旋转图标）
   - mock 发送 `agent_end_done`
   - 验证：指示器消失

**Mock 数据模式**：

```ts
// 模拟一个完整的 agent turn 事件序列
function createMockEventSequence(): Array<{ delay: number; event: AgentEvent }> {
  return [
    { delay: 100, event: { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } } },
    { delay: 100, event: { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] } } },
    { delay: 100, event: { type: "tool_execution_start", toolCallId: "tc1", toolName: "read_file", args: { path: "a.md" } } },
    { delay: 100, event: { type: "tool_execution_end", toolCallId: "tc1", toolName: "read_file", result: "content" } },
    { delay: 100, event: { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Based on" }] } } },
    { delay: 100, event: { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Based on the file..." }] } } },
    { delay: 0,   event: { type: "agent_end_done" } },
  ];
}
```

通过 `page.routeWebSocket()` 将 `/ws/chat/:sessionId` 的 WebSocket 连接拦截，在收到 `message` 类型客户端消息后按 delay 顺序推送事件。

## 影响范围

| 文件 | 变更类型 |
|------|----------|
| `packages/app/src/features/chat/streaming-store.ts` | 新建 |
| `packages/app/src/features/chat/hooks/useChatSession.ts` | 重构 |
| `packages/app/src/features/chat/hooks/useChatScroll.ts` | 修改（scroll 位置保持） |
| `packages/app/src/features/agent-session-list/SessionRow.tsx` | 修改（streaming 指示器） |
| `packages/app/e2e/chat-streaming-resilience.spec.ts` | 新建 |

后端（`packages/server`、`packages/core`）无需改动。
