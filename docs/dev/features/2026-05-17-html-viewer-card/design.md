# HTML Viewer Card

## 概述

在对话流中支持渲染 HTML 内容卡片。Agent 通过调用 `render_card` tool 主动触发卡片渲染，HTML 内容在聊天界面中以 iframe 形式展示。支持两种内容来源：inline HTML 和项目文件引用。

## 背景

当前 assistant 回复通过 `react-markdown` 渲染为 Markdown，`ContentBrowser` 有 HTML 文件预览功能，但聊天流中没有任何 HTML 内容卡片的渲染能力。

## 需求

1. Agent 可在对话中渲染 HTML 内容卡片（如网页、图表、样式文档等）
2. 支持 inline HTML 和引用项目文件两种方式
3. 允许 JS 执行（支持 Chart.js 等交互式内容）
4. LLM 通过 tool 参数控制卡片尺寸，有最大宽高限制
5. 卡片默认直接渲染显示，无需切换
6. 历史消息重新加载时能恢复卡片渲染

## 技术方案

### 方案选择

利用 pi-agent-core 的 `tool_execution_update` 事件机制（tool 的 `onUpdate` 回调），将卡片数据传递到前端。pi-agent-core 的 `AgentEvent` 是封闭的 10 种类型集合，不支持自定义事件，因此复用 `tool_execution_update` 是最合适的方式。

### 数据流

```
Agent 调用 render_card tool
  → pi-agent-core 执行 tool
  → tool 通过 onUpdate({ type: "html", html, ... }) 发送卡片数据
  → pi-agent-core 发出 tool_execution_update 事件
  → Engine.onEvent 转发
  → WebSocket 发送到前端
  → ChatPage 检测 toolName === "render_card"
  → 解析 partialResult 为 HtmlCard
  → 渲染 HtmlCardRenderer 组件
```

### 1. Core 层：render_card Tool

**新增文件**：`packages/core/src/tools/render-card.ts`

工厂函数模式：`createRenderCardTool(projectRoot: string): AgentTool`

**参数 Schema**（@sinclair/typebox）：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| type | `"html"` | 是 | - | 卡片类型（预留扩展） |
| content | string | 否* | - | inline HTML 内容 |
| file_path | string | 否* | - | 项目中的 HTML 文件路径 |
| title | string | 否 | - | 卡片标题 |
| width | number | 否 | - | 卡片宽度（px） |
| height | number | 否 | 400 | 卡片高度（px） |
| max_width | number | 否 | 800 | 最大宽度（px） |
| max_height | number | 否 | 600 | 最大高度（px） |

*`content` 和 `file_path` 必须提供其中之一，优先使用 `file_path`。

**执行逻辑**：

1. 校验参数：`content` 或 `file_path` 二选一
2. 如果提供 `file_path`：路径安全校验（`path.resolve + startsWith`），读取文件内容作为 HTML
3. 通过 `onUpdate` 发送卡片数据：`{ type: "html", html, title, width, height, max_width, max_height }`
4. 返回简短确认给 LLM：`"HTML card rendered successfully"`

**Tool 描述**（给 LLM）：

> Render HTML content as a visual card in the chat. Use this to display rich HTML content such as web pages, charts, diagrams, or styled documents. You can provide HTML inline via the `content` parameter or reference a project file via `file_path`. Use `width`, `height`, `max_width`, and `max_height` to control the card dimensions.

### 2. Server 层

无需修改。`ws-chat.ts` 已透传所有 `AgentEvent` 到前端，包括 `tool_execution_update`。

### 3. 前端

#### 类型扩展（`packages/app/src/lib/types.ts`）

```typescript
interface HtmlCard {
  type: "html";
  html: string;
  title?: string;
  width?: number;
  height?: number;
  max_width?: number;
  max_height?: number;
}
```

在 `ToolCallInfo` 中新增可选字段 `_card?: HtmlCard`。

#### ChatPage.tsx — 事件处理

修改 `handleWsEvent` 中 `tool_execution_update` 的处理逻辑：

当 `toolName === "render_card"` 时，将 `partialResult` 解析为 `HtmlCard` 并设置到对应 `ToolCallInfo._card`。

#### ChatPage.tsx — 消息渲染

在 assistant 消息中，遍历 `msg._toolCalls`，对每个有 `_card` 的 toolCall 渲染 `<HtmlCardRenderer>` 组件。

#### 历史消息恢复

重新加载时，前端从 `getSessionMessages` 返回的原始消息中提取 `render_card` 的 tool call（通过 toolName 识别），从其 `arguments` 中恢复 HtmlCard 数据。这需要在消息加载的转换逻辑中处理。

### 4. HtmlCardRenderer 组件

**新增文件**：`packages/app/src/components/HtmlCard.tsx`

```tsx
interface HtmlCardRendererProps {
  card: HtmlCard;
}
```

渲染为 `<iframe srcDoc={card.html} sandbox="allow-scripts allow-same-origin">`，外层 div 控制尺寸约束。

- 宽度：`card.width ?? '100%'`，最大 `card.max_width ?? 800`
- 高度：`card.height ?? 400`，最大 `card.max_height ?? 600`
- 可选标题栏显示 `card.title`
- iframe 样式：圆角、边框

### 5. iframe 安全策略

`sandbox="allow-scripts allow-same-origin"`：
- `allow-scripts`：允许 JS 执行（需求要求）
- `allow-same-origin`：允许加载项目内的 CSS/JS 等资源

### 6. 涉及文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/core/src/tools/render-card.ts` | render_card tool 实现 |
| 修改 | `packages/core/src/tools/index.ts` | 注册新 tool |
| 修改 | `packages/app/src/lib/types.ts` | 新增 HtmlCard 类型、扩展 ToolCallInfo |
| 修改 | `packages/app/src/pages/ChatPage.tsx` | 处理 render_card 事件 + 渲染卡片 + 历史恢复 |
| 新增 | `packages/app/src/components/HtmlCard.tsx` | 卡片渲染组件 |
| 新增 | `packages/core/src/__tests__/tools/render-card.ts` | 单元测试 |

### 7. 测试策略

- **单元测试**（`packages/core`）：`render-card.ts` 的测试用例
  - inline HTML 渲染
  - 文件路径渲染（含路径穿越校验）
  - 参数校验（content 和 file_path 互斥）
  - onUpdate 被正确调用
  - 默认尺寸参数
- **手动测试**：在桌面应用中实际渲染 HTML 卡片验证
