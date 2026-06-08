# Feature: Agent 聊天窗口主题自定义

> Date: 2026-06-07
> Status: Design Approved

## 概述

支持 agent 级别的聊天窗口主题自定义。每个 agent 可以拥有独立的 `theme.css` 文件，用户可在 Agent Dialog 的"主题"标签页中编辑，实现自定义颜色、气泡样式、头像、背景图片、输入框样式等。

## 需求

- 每个 agent 一个主题，该 agent 的所有聊天 session 共享
- 主题文件存放在 agent 目录下的 `theme.css`
- 在 Agent Dialog 新增"主题"标签页，提供纯文本代码编辑器
- 允许用户编写任意 CSS 规则
- Agent 主题优先级高于项目级主题（覆盖同名变量/规则）
- 新建 agent 时自动生成带注释模板的 `theme.css`
- 主题无预览，保存后在聊天窗口生效

## 存储设计

### 文件结构

```
.spherse/agents/{slug}-{shortId}/
├── profile.md        # 已有 — agent 配置
└── theme.css         # 新增 — 聊天窗口主题
```

- `theme.css` 与 `profile.md` 同目录
- 删除 agent 时整个目录删除，`theme.css` 随之移除
- `AgentProfile` 类型不变，主题作为独立文件管理

### 默认模板

模板文件：`packages/presets/templates/agent-theme-template.css`

新建 agent 时，前端从 presets 加载模板内容，作为 `themeContent` 传给创建 API。模板包含以下注释示例（全部默认注释掉）：

- 基础颜色变量（background、foreground、primary 等）
- 聊天窗口背景图片
- 用户/助手气泡样式（圆角、阴影、边框）
- 助手消息头像（通过 `::before` 伪元素）
- 输入框样式

## DOM 标识

为支持 CSS 精准定制，在聊天组件的关键 DOM 元素上添加 `data-*` 属性：

| 元素 | data 属性 | 用途 |
|------|-----------|------|
| Chat 容器（最外层） | `data-chat-root` | 聊天窗口背景、整体布局、CSS scope 锚点 |
| 消息列表区域 | `data-chat-messages` | 消息区域背景 |
| 单条消息容器 | `data-chat-message` + `data-role="user"` / `data-role="assistant"` | 区分用户/助手消息，支持分别定制 |
| 输入框区域 | `data-chat-composer` | 输入框样式 |

涉及的文件变更：

- `packages/app/src/features/chat/index.tsx` — 外层容器添加 `data-chat-root`
- `packages/app/src/features/chat/MessageList.tsx` — 消息列表容器添加 `data-chat-messages`
- `packages/app/src/features/chat/MessageItem.tsx` — 消息容器添加 `data-chat-message` + `data-role`
- `packages/app/src/features/chat/Composer.tsx` — 输入框容器添加 `data-chat-composer`

## 主题加载机制

采用 `<style>` 标签动态注入方案：

1. `Chat` 组件 mount 时，通过 agent ID 调用 `GET /api/agents/:id/theme` 获取 `theme.css` 内容
2. CSS 文本存入 React state
3. 在 `[data-chat-root]` 容器内渲染一个 `<style>` 标签
4. 通过文本处理，将用户 CSS 的每个顶级选择器前插入 `[data-chat-root]` 前缀，限定作用域
5. unmount 时 `<style>` 标签随组件自动移除

### Scope 处理

用户编写的 CSS 会被包裹在 `[data-chat-root]` 选择器下。例如用户写：

```css
--shadcn-primary: #ff6b6b;
background-image: url('...');
```

注入后变为：

```css
[data-chat-root] {
  --shadcn-primary: #ff6b6b;
  background-image: url('...');
}
```

用户写的选择器规则：

```css
[data-chat-message][data-role="assistant"]::before {
  content: '';
  width: 36px;
  height: 36px;
  ...
}
```

注入后变为：

```css
[data-chat-root] [data-chat-message][data-role="assistant"]::before {
  content: '';
  width: 36px;
  height: 36px;
  ...
}
```

### 错误处理

- theme.css 不存在或为空 → 不注入任何样式，使用全局默认
- CSS 语法错误 → 浏览器原生容错，静默忽略

### 新增 Hook

`packages/app/src/features/chat/hooks/useAgentTheme.ts`

- 接收 `client: ApiClient` 和 `agentId: string`
- 调用 `GET /api/agents/:id/theme` 获取内容
- 返回 scope 处理后的 CSS 文本
- 在 `Chat` 组件中使用，将结果渲染为 `<style>` 标签

## Agent Dialog 改造

### 标签页结构

当前 `AgentDialog` 是单页表单，改造为双标签页：

- **"基本"标签页** — 现有表单内容（名称、工具、上下文路径、系统提示词），保持不变
- **"主题"标签页** — 全高 `<textarea>` 代码编辑器，加载并编辑 `theme.css` 内容

### 交互流程

1. 打开 agent dialog（create/edit）时，同时加载 profile.md 和 theme.css
2. create 模式下，主题标签页显示 presets 模板内容
3. edit 模式下，主题标签页显示当前 agent 的 `theme.css` 内容
4. 点击 dialog 底部"保存"按钮时，profile 和 theme.css 一起提交保存
5. 保存后聊天窗口重新加载即可看到效果

### 涉及文件

- `packages/app/src/components/AgentDialog.tsx` — 添加标签页结构、主题编辑器

## Server API

### 现有端点变更

| 端点 | 变更 |
|------|------|
| `PUT /api/agents/:id` | body 新增可选字段 `themeContent?: string`，保存时写入 `theme.css` |
| `POST /api/agents/create` | body 新增可选字段 `themeContent?: string`，创建 agent 后写入 `theme.css` |

### 新增端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agents/:id/theme` | GET | 返回 `theme.css` 文件内容（`Content-Type: text/css`），文件不存在返回空字符串 |

## Core 层变更

`packages/core/src/store/agent-profile.ts` — `AgentProfileStore` 新增：

- `getTheme(agentId: string): string` — 读取 agent 目录下 `theme.css`，不存在返回空字符串
- `saveTheme(agentId: string, content: string): void` — 写入 `theme.css` 到 agent 目录

## Presets 变更

新增文件 `packages/presets/templates/agent-theme-template.css`，包含注释掉的示例 CSS，覆盖：

- 基础颜色变量
- 背景图片
- 气泡样式
- 头像（伪元素）
- 输入框样式

构建流程与现有 presets 模板一致。

## i18n

新增 2 个 key：

| Key | zh-CN | 场景 |
|-----|-------|------|
| `agent-dialog.tabBasic` | 基本 | Agent dialog 标签页标题 |
| `agent-dialog.tabTheme` | 主题 | Agent dialog 标签页标题 |

## 涉及文件总览

### 新增文件

| 文件 | 说明 |
|------|------|
| `packages/presets/templates/agent-theme-template.css` | 主题模板 |
| `packages/app/src/features/chat/hooks/useAgentTheme.ts` | 主题加载 hook |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/core/src/store/agent-profile.ts` | 新增 `getTheme`/`saveTheme` 方法 |
| `packages/server/src/routes/agents.ts` | 新增 `GET /api/agents/:id/theme` 端点 |
| `packages/server/src/routes/agent-write.ts` | create/update 端点支持 `themeContent` |
| `packages/app/src/features/chat/index.tsx` | 添加 `data-chat-root`，使用 `useAgentTheme` |
| `packages/app/src/features/chat/MessageList.tsx` | 添加 `data-chat-messages` |
| `packages/app/src/features/chat/MessageItem.tsx` | 添加 `data-chat-message` + `data-role` |
| `packages/app/src/features/chat/Composer.tsx` | 添加 `data-chat-composer` |
| `packages/app/src/components/AgentDialog.tsx` | 双标签页 + 主题编辑器 |
| `packages/app/src/lib/api.ts` | 新增 `getAgentTheme()` 方法 |
| `packages/i18n/src/locales/zh-CN.ts` | 新增 2 个 key |
| `packages/i18n/src/locales/zh-TW.ts` | 新增 2 个 key |
| `packages/i18n/src/locales/en.ts` | 新增 2 个 key |
