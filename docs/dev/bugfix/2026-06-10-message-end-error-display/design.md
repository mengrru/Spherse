# [fix] 展示 message_end 中的 error message

## 问题描述

当 LLM 调用失败（rate limit、context 过长、API 错误等），`pi-ai` 通过 `message_end` 事件传递一个 `AssistantMessage`，其中 `stopReason: "error"` 且可能携带 `errorMessage?: string`。

当前前端 `chat-session-reducer.ts` 在处理 `message_end` 时，只提取 `content` 中的 `textContent.text`，完全忽略 `stopReason` 和 `errorMessage`。这导致用户在 LLM 出错时看不到任何错误反馈（可能看到空消息或无任何提示）。

## 根因分析

- `AssistantMessage`（来自 `@mariozechner/pi-ai`）定义了 `stopReason: StopReason` 和 `errorMessage?: string`
- `message_end` 事件的 `message` 字段携带完整的 `AssistantMessage`
- `chat-session-reducer.ts:84-97` 处理 `message_end` 时只读取 text content，不检查 error 状态
- `ChatMessage` 类型没有错误相关字段，无法传递错误信息到 UI 层
- 现有的 `appendErrorMessage` 仅用于 transport-level `error` 事件，不处理 LLM-level 错误

## 方案

### 1. 扩展 `ChatMessage` 类型

**文件**: `packages/app/src/lib/types.ts`

在 `ChatMessage` 接口上新增 `_error?: string` 字段：

```typescript
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  _streaming?: boolean;
  _toolCalls?: ToolCallInfo[];
  _error?: string;
}
```

### 2. 修改 Reducer 处理 `message_end`

**文件**: `packages/app/src/features/chat/chat-session-reducer.ts`

在 `message_end` 分支（第 84-97 行）中：

- 检查 `event.message.stopReason === "error"`
- 若为 true，在最终消息上设置 `_error: event.message.errorMessage ?? "Unknown error"`
- 当 `stopReason === "error"` 且 text 为空时，仍保留消息（不丢弃），确保错误信息可见
- 当 `stopReason === "aborted"` 时，不设置 `_error`（中止是用户主动行为）

### 3. UI 渲染错误信息

**文件**: `packages/app/src/features/chat/MessageItem.tsx`

在消息气泡内、text content 下方、tool calls 上方，当 `_error` 存在时渲染错误提示区域：

- 使用 `text-destructive` 和 `bg-destructive/10` 等 shadcn 语义 token
- 在消息内容下方、tool calls 上方显示
- 不使用硬编码颜色值

### 不需要改动的部分

- **Server contract**: `message` 字段已是 `Type.Any()`，无需调整 schema
- **Engine / core 层**: 只是透传事件，不做处理
- **`appendErrorMessage`**: transport-level error 仍走原逻辑不变
- **`parseHistoryMessages`**: 历史消息从存储加载时，`AssistantMessage` 的 `errorMessage` 已不在 content 中，历史消息的 `_error` 不需要持久化到 `ChatMessage`（错误是瞬态 UI 状态）

## 涉及文件

| 文件 | 改动 |
|------|------|
| `packages/app/src/lib/types.ts` | `ChatMessage` 新增 `_error?: string` |
| `packages/app/src/features/chat/chat-session-reducer.ts` | `message_end` 分支检查 `stopReason`，设置 `_error` |
| `packages/app/src/features/chat/MessageItem.tsx` | 渲染 `_error` 错误提示区域 |
| `packages/app/src/features/chat/chat-session-reducer.test.ts` | 补充 `message_end` error 场景测试 |
