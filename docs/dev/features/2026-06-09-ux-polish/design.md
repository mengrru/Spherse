# UX 小优化合集

## 背景

Content browser 文本选中工具和 agent/session 侧边栏存在若干体验瑕疵：选中文本后只能发起新会话，无法快速复制或追加到已有会话；删除 session 无确认提示；选中 session 时对应 agent 行无视觉反馈；agent 列表默认展开第一项造成干扰。

## 目标

1. 选中文本工具条化，支持复制和开始会话两个快捷操作
2. 支持将选中文字追加到当前正在查看的 session
3. 删除 session 前弹出确认对话框
4. 选中的 session 所属 agent 行自动高亮
5. agent 列表初始化时全部折叠

## 涉及文件

| 文件 | 变更 |
|------|------|
| `packages/app/src/features/text-selection-session/StartSessionButton.tsx` | 重构为 `TextSelectionToolbar.tsx`，工具条包含复制和开始会话两个按钮 |
| `packages/app/src/features/text-selection-session/StartSessionPopover.tsx` | 新增"发送至当前会话"按钮区域 |
| `packages/app/src/features/text-selection-session/index.tsx` | 新增 `currentSessionId`、`onSendToCurrentSession` props |
| `packages/app/src/features/content-browser/index.tsx` | 透传 `currentSessionId`、`onSendToCurrentSession` |
| `packages/app/src/layouts/ProjectLayout.tsx` | 新增 `handleSendToCurrentSession` 回调 |
| `packages/app/src/features/agent-session-list/index.tsx` | 新增 session 删除确认 AlertDialog |
| `packages/app/src/features/agent-session-list/AgentGroup.tsx` | 计算 `isActive` 并传给 `AgentRow` |
| `packages/app/src/features/agent-session-list/AgentRow.tsx` | 接收 `active` prop，条件添加 `bg-accent` |
| `packages/app/src/stores/project-ui-store.ts` | 无变更（初始化逻辑在 `AgentSessionList`） |
| `packages/i18n/src/locales/zh-CN.ts` | 新增文案 |
| `packages/i18n/src/locales/zh-TW.ts` | 新增文案 |
| `packages/i18n/src/locales/en.ts` | 新增文案 |

## 详细设计

### 1. 选中文本工具条

**现状**：`StartSessionButton` 是一个浮动按钮（fixed z-50），显示在鼠标位置附近，含 `MessageCircleIcon` + "开始会话" 文字。

**改为**：将 `StartSessionButton.tsx` 重命名为 `TextSelectionToolbar.tsx`，渲染一个紧凑的工具条：

- 两个按钮紧邻排列，共享圆角容器（`bg-popover border rounded-md shadow-md`）
- 左侧：复制按钮（`CopyIcon`），无文字
- 右侧：开始会话按钮（`MessageCircleIcon` + 文字），点击展开 popover
- 复制按钮点击行为：调用 `navigator.clipboard.writeText(selectedText)`，然后调用 `onCopy()` 清理选区状态和高亮
- 工具条位置计算与原 `StartSessionButton` 相同（基于鼠标坐标，clamp 到视口内）

**组件接口**：

```ts
interface TextSelectionToolbarProps {
  position: { x: number; y: number };
  selectedText: string;
  onStartSession: () => void;
  onCopy: () => void;
  visible: boolean;
}
```

**Dismiss 逻辑**：工具条和 popover 共用 `useDismissable` hook，行为不变。

### 2. 发送至当前 Session

**现状**：`StartSessionPopover` 显示文件路径引用 → 选文预览（≤200 字符）→ 评论输入 → agent 列表（滚动区域，max-height 240px）。用户只能选择一个 agent 创建新 session。

**改为**：在 agent 列表之前插入一个独立的按钮区域：

- 有活动 session 时：渲染"发送至当前会话"按钮（使用 `SendIcon` 或类似图标），显示当前 session 的标题或 agent 名称
- 无活动 session 时：按钮置灰（`opacity-50 pointer-events-none`），hover 时 tooltip 显示"无活动会话"
- 点击后调用 `onSendToCurrentSession(text, comment)` → 追加消息到当前 session → navigate 到该 session 聊天视图 → 清理选区状态

**数据流**：

```
ProjectLayout
  ├── currentSessionId (from URL)
  ├── handleSendToCurrentSession(text, sourcePath, comment)
  │     → sendMessage(projectKey, client, sessionId, formattedMessage)
  │     → navigate to chat
  ├── ContentBrowser
  │     ├── currentSessionId
  │     ├── onSendToCurrentSession
  │     └── TextSelectionSession
  │           ├── currentSessionId
  │           ├── onSendToCurrentSession
  │           └── StartSessionPopover
  │                 ├── currentSessionId
  │                 └── onSendToCurrentSession
```

**消息格式**：与现有 `handleStartSession` 一致——blockquote 包裹选中文本，前缀含文件路径，后缀附可选评论。

**发送 API**：使用 `streaming-store` 的 `sendMessage` 方法（如果 session 已 attached），或通过 `project-data-store` 调用 API 发送消息。

### 3. 删除 Session 确认提示

**现状**：`SessionRow` 右键菜单 Delete 直接调用 `onDelete(session.id)`，`handleDeleteSession` 立即执行删除。

**改为**：遵循 agent 删除的确认模式：

- `AgentSessionList` 新增 `deleteSessionTarget: SessionInfo | null` state
- `handleDeleteSessionRequest(session: SessionInfo)` 设置 `deleteSessionTarget`
- `handleConfirmDeleteSession()` 执行原有删除逻辑并清空 target
- `handleCancelDeleteSession()` 仅清空 target
- 渲染 `AlertDialog`：
  - `open={!!deleteSessionTarget}`
  - 标题：`删除会话？`
  - 描述：包含 session 标题（或"无标题会话"）
  - 取消按钮 + 删除按钮（destructive variant）
- `SessionRow` 的 `onDelete` 回调签名改为传递完整 `SessionInfo` 对象而非仅 `id`

### 4. 选中 Session 对应 Agent 行高亮

**现状**：`AgentRow` 无选中状态，`AgentGroup` 不计算 active 状态。

**改为**：

- `AgentGroup` 根据 `activeSessionId` 和该 agent 下的 sessions 列表计算 `isActive`：
  ```ts
  const isActive = sessions.some(s => s.id === activeSessionId);
  ```
- 将 `isActive` 作为 `active` prop 传给 `AgentRow`
- `AgentRow` 的 `TreeRow` 组件上条件添加 `bg-accent` class
- 高亮效果与 session 列表展开时一致（使用相同的 `bg-accent` token）
- 当 agent 折叠时也能看到高亮，让用户知道选中的 session 属于哪个 agent

### 5. Agent 列表全部默认折叠

**现状**：`AgentSessionList` 初始化时 `collapsedAgentIds.size === 0` 则 `agents.slice(1).map(a => a.id)`，即第一个 agent 展开。

**改为**：初始化时将所有 agent 加入折叠集合：

```ts
const nextCollapsedAgentIds = collapsedAgentIds.size === 0
  ? agents.map((agent) => agent.id)
  : [...collapsedAgentIds].filter((id) => validAgentIds.has(id));
```

仅此一行变更，其余逻辑不变。

## i18n 文案

在 `packages/i18n/src/locales/zh-CN.ts` 新增：

| key | 值 | 说明 |
|-----|----|------|
| `text-selection.copy` | `"复制"` | 文本选中工具条的复制按钮 tooltip |
| `text-selection.sendToCurrentSession` | `"发送至当前会话"` | Popover 中发送到当前 session 的按钮文字 |
| `text-selection.noActiveSession` | `"无活动会话"` | 无活动 session 时的 tooltip |
| `session.confirmDeleteTitle` | `"删除会话？"` | 删除确认对话框标题 |
| `session.confirmDeleteDescription` | `"确定要删除会话「{title}」吗？此操作无法撤销。"` | 删除确认对话框描述 |
| `session.untitled` | `"无标题会话"` | session 无标题时的兜底文字 |
