# 折叠工具调用过程

## 概述

将 agent 的 tool call 过程默认折叠，点击展开查看参数详情。同时修复 tool call 事件类型不匹配导致 tool call 信息从未正确显示的 bug。

## 背景

- 前端 `handleWsEvent` 监听 `tool_call`/`tool_result`，但 pi-agent-core 实际发出 `tool_execution_start`/`tool_execution_end`，导致 tool call 信息无法正确流入前端
- 当前 tool call UI 仅显示工具名 + 状态（done/...），无折叠、无参数展示
- 加载历史消息时丢弃了 tool call 数据

## 设计

### 1. 事件类型修复

**文件**：`packages/app/src/lib/types.ts`

更新 `AgentEvent` 中 tool 相关事件类型名，匹配 pi-agent-core：

- `tool_call` → `tool_execution_start`（字段：`toolCallId`, `toolName`, `args`）
- `tool_result` → `tool_execution_end`（字段：`toolCallId`, `toolName`, `result`, `isError`）
- 新增 `tool_execution_update`（字段：`toolCallId`, `toolName`, `args`, `partialResult`）

**文件**：`packages/app/src/pages/ChatPage.tsx`

`handleWsEvent` 更新：

- `tool_execution_start`：创建 `ToolCallInfo`，包含 `toolCallId`，status=`running`
- `tool_execution_update`：更新对应 toolCallId 的 `partialResult`
- `tool_execution_end`：更新 status 为 `completed`/`error`，设置 `result`
- 匹配逻辑改为按 `toolCallId` 查找

### 2. ToolCallSection 组件

**新文件**：`packages/app/src/components/ToolCallSection.tsx`

```ts
interface ToolCallSectionProps {
  toolCalls: ToolCallInfo[];
  defaultExpanded?: boolean; // 默认 false
}
```

**折叠状态**：组件内部 `useState<Set<string>>` 管理已展开的 toolCallId。

**渲染**：

- 整个区域位于消息气泡内，上方虚线分隔
- **折叠态**：每个 tool call 一行，`▸ 工具名 → 参数摘要 ✓/...`
  - 参数摘要：从 `args` 取第一个有意义的字符串值（如 `path`、`name`），截断至 40 字符；无有意义值时显示 key 列表
- **展开态**：折叠行下方展示格式化参数（key-value 表格，代码值用 `<code>` 样式）
- 点击行切换展开/折叠，`▸` 变为 `▾`
- status 指示：`running` 显示蓝色 `...`，`completed` 显示绿色 `✓`，`error` 显示红色 `✗`

### 3. ToolCallInfo 类型更新

**文件**：`packages/app/src/lib/types.ts`

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

`result` 和 `partialResult` 当前不渲染，留作未来 debug 模式钩子。

### 4. 历史消息加载修复

**文件**：`packages/app/src/pages/ChatPage.tsx`

当前加载逻辑（lines 63-80）仅保留 `type: "text"` 内容块，丢弃所有 tool call 数据。需修复为：

1. **重建 `_toolCalls`**：遍历 assistant message 的 `content` 数组，提取 `type: "toolCall"` 块，生成 `ToolCallInfo[]`（status=`completed`，附上 toolName、arguments、toolCallId）
2. **匹配 result**：从相邻的 `role: "toolResult"` 消息中，通过 `toolCallId` 关联 result 到对应的 `ToolCallInfo`
3. **过滤 toolResult 消息**：`role: "toolResult"` 消息不作为独立消息渲染，仅用于补充 `_toolCalls` 数据
4. **数据一致性**：加载后的 `_toolCalls` 数据结构必须与 streaming 时 `handleWsEvent` 生成的一致，`ToolCallSection` 组件无需区分数据来源

DB 存储侧无需改动——pi-agent-core 的完整消息（含 `AssistantMessage` 的 `toolCall` 内容块和独立的 `ToolResultMessage`）已以 JSON 原样存入 SQLite `content` 列。

### 5. ChatPage 集成

**文件**：`packages/app/src/pages/ChatPage.tsx`

- 替换内联 tool call 渲染（原 lines 229-240）为 `<ToolCallSection toolCalls={msg._toolCalls} />`

## 不在范围内

- Debug 模式（显示 result、partialResult）— 本次不实现，但类型和事件处理预留钩子
- `tool_execution_update` 的 UI 渲染— 本次不实现
