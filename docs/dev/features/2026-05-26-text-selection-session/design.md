# 划取文本发起会话

## 概述

在 ContentBrowser 中浏览文件内容时，用户可以通过鼠标划取文本，通过浮动工具栏弹出内联评论框，选择目标 Agent 后自动创建新会话并发送结构化消息，随后自动跳转到聊天页面。

## 交互流程

```
选中文本 → 浮动工具栏出现 → 点击工具栏 → 弹出内联评论框 →
点击发送 → Agent 列表展开 → 选择 Agent → 自动创建会话 + 发送消息 + 跳转聊天
```

### 步骤详解

1. **文本选区检测**：用户在 ContentBrowser 中选中文件内容文本
2. **浮动工具栏**：选区上方出现 "💬 发起会话" 浮动按钮
3. **内联评论框**：点击按钮后展开评论框，包含：
   - 引用来源（文件相对路径）
   - 引用文本预览（超过 200 字截断显示）
   - 补充说明输入（可选）
   - 发送按钮
4. **Agent 选择**：点击发送按钮后，评论框内展开 Agent 列表
5. **发送并跳转**：选择 Agent 后，创建会话 → 发送消息 → 刷新会话列表 → 跳转聊天页面

## 约束与边界

- **适用范围**：仅在 ContentBrowser 的文件内容预览/源码模式中支持（Markdown 渲染、`<pre>` 文本、HTML 源码视图）
- **不适用**：HTML iframe 预览模式、文件编辑模式（textarea）
- **会话行为**：始终创建新会话，不支持追加到已有会话
- **不涉及后端改动**：使用现有的 `POST /api/sessions` + WebSocket 消息协议

## 结构化消息格式

发送给 Agent 的消息格式：

```
请处理以下来自「{filePath}」的内容：

> {selectedText}

{用户补充说明，如有}
```

示例（用户选中了 `world/geo.md` 中的一段文本，补充说明为 "请帮我扩展这段描述"）：

```
请处理以下来自「world/geo.md」的内容：

> 这座塔楼是上古文明留下的最后一处遗迹，内部封印着足以改变世界的力量。

请帮我扩展这段描述
```

## 组件设计

### 新增组件

#### `TextSelectionToolbar`

浮动工具栏按钮，在文本选区上方渲染。

```typescript
interface TextSelectionToolbarProps {
  position: { x: number; y: number }
  onAction: () => void
  onClose: () => void
}
```

- 使用 `position: fixed` + `z-index: 50`
- 水平居中于选区上方；若靠近视口顶部则定位到选区下方
- 点击外部或选区消失时自动关闭

#### `SelectionSessionDialog`

内联评论框 + Agent 选择器，两阶段交互。

```typescript
interface SelectionSessionDialogProps {
  selectedText: string
  sourcePath: string
  agents: AgentProfile[]
  position: { x: number; y: number }
  onSubmit: (agentId: string, comment?: string) => void
  onClose: () => void
}
```

**阶段 1（compose）**：
- 显示引用来源文件路径
- 显示选中文本预览（超长截断，带左边框高亮）
- 可选补充说明 textarea
- 发送按钮

**阶段 2（select-agent）**：
- 点击发送后，在评论框内展开 Agent 列表
- 每个 Agent 显示名称，右侧有"发送"文字
- 点击某个 Agent 触发 `onSubmit(agentId, comment)`

**关闭行为**：点击外部或按 Escape 关闭整个对话框。

### 修改现有组件

#### `ContentBrowser`

- 新增 props：
  - `agents: AgentProfile[]` — 可用 Agent 列表
  - `onStartSession?: (agentId: string, selectedText: string, sourcePath: string, comment?: string) => void` — 用户选择 Agent 后的回调
- 新增 state：`selectionToolbar`（选区文本 + 位置）和 `showSessionDialog`（是否显示评论框）
- 在文件内容渲染区域（Markdown 渲染、`<pre>` 文本）监听 `mouseup` 事件
- 检测 `window.getSelection()` 是否有选中文本
- 有选中 → 显示 `TextSelectionToolbar`
- 工具栏被点击 → 显示 `SelectionSessionDialog`，传入选中文本、文件路径和 agents 列表
- 用户选择 Agent → 调用 `onStartSession(agentId, selectedText, sourcePath, comment)`
- 不在编辑模式（textarea）和 HTML iframe 中启用此功能

#### `ProjectPage`

- 将 `agents` 列表和 `onStartSession` 回调传递给 ContentBrowser
- 在 `onStartSession` 回调中处理会话创建编排：
  1. 构建结构化消息
  2. 调用 `client.createSession(agentId)` → 获取 `sessionId`
  3. 刷新会话列表
  4. 设置 `selectedSession`（新创建的 session）和 `selectedAgent`
  5. 将结构化消息作为 `initialMessage` 传递给 ChatPage
  6. 切换 `viewMode = "chat"`

#### `ChatPage`

- 新增 prop `initialMessage?: string`
- WebSocket 连接建立后，若 `initialMessage` 存在，自动发送该消息
- 发送后清除 `initialMessage`（通过回调或 ref），避免重复发送

## 状态管理

| 状态 | 管理方 | 说明 |
|------|--------|------|
| 选区文本 + 位置 | ContentBrowser | `mouseup` 事件检测 |
| 工具栏显示/隐藏 | ContentBrowser | `selectionToolbar` state |
| 评论框显示/隐藏 | ContentBrowser | `showSessionDialog` state |
| 评论框阶段 | SelectionSessionDialog | `phase: "compose" \| "select-agent"` |
| 补充说明文本 | SelectionSessionDialog | 内部 state |
| Agent 列表 | ProjectPage | 已有，通过 props 传递给 ContentBrowser |
| 会话创建 + 导航 | ProjectPage | 通过回调处理 |

## 会话创建流程（前端编排）

不修改后端，使用现有 API。采用"创建会话 → 跳转聊天页 → 自动发送初始消息"的方式，避免管理临时 WebSocket 连接：

```
1. client.createSession(agentId)           → { sessionId }
2. 构建 selectedSession + selectedAgent + initialMessage
3. 切换 viewMode = "chat"，渲染 ChatPage
4. ChatPage 建立 WebSocket 连接后自动发送 initialMessage
```

## 样式约定

- 浮动工具栏：`fixed z-50 bg-surface border border-[var(--border)] rounded-md shadow-lg`，与现有右键菜单风格一致
- 评论框：`fixed z-50 bg-surface border border-[var(--border)] rounded-lg shadow-xl`，最大宽度 400px
- 引用文本：`border-l-3 border-[var(--accent)] bg-surface-2 opacity-80`
- Agent 列表项：`hover:bg-[var(--hover)]`，与现有菜单项风格一致
- 使用 Tailwind CSS v4 工具类 + CSS 变量色彩体系，不写原生 CSS class
