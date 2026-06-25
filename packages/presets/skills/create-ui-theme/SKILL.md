---
name: create-ui-theme
description: 指导用户创建自定义 UI 主题，通过 .spherse/theme.css 覆盖 CSS 变量实现视觉定制
---

# 自定义 UI 主题

Spherse 支持通过项目级 CSS 变量覆盖来自定义 UI 外观。在项目根目录创建 `.spherse/theme.css`，覆盖对应的 CSS 变量即可生效。

所有 design token 统一使用 `--sp-*` 前缀（Spherse 自有命名空间）。只覆盖你想修改的变量，未覆盖的保持默认。

## 可用变量

所有变量都支持浅色和深色两套值（深色值由 OS `prefers-color-scheme` 驱动）。

### 页面与容器

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--sp-background` | `#fafafa` | `#171717` | 页面背景 |
| `--sp-foreground` | `#171717` | `#fafafa` | 页面主文字色 |
| `--sp-card` | `#ffffff` | `#262626` | 卡片/面板背景 |
| `--sp-card-foreground` | `#171717` | `#fafafa` | 卡片内文字色 |

### 弹出层

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--sp-popover` | `#ffffff` | `#262626` | 弹窗/下拉菜单背景 |
| `--sp-popover-foreground` | `#171717` | `#fafafa` | 弹窗内文字色 |

### 交互元素

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--sp-primary` | `#171717` | `#fafafa` | 主操作按钮背景、选中态 |
| `--sp-primary-foreground` | `#fafafa` | `#171717` | 主操作按钮文字色 |
| `--sp-secondary` | `#f5f5f5` | `#262626` | 次要按钮背景 |
| `--sp-secondary-foreground` | `#171717` | `#fafafa` | 次要按钮文字色 |
| `--sp-accent` | `#f5f5f5` | `#262626` | 悬停/选中背景 |
| `--sp-accent-foreground` | `#171717` | `#fafafa` | 悬停/选中文字色 |

### 文字层级

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--sp-muted` | `#f5f5f5` | `#262626` | 弱化背景 |
| `--sp-muted-foreground` | `#737373` | `#a3a3a3` | 次要/辅助文字色 |

### 边框与输入

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--sp-border` | `#e5e5e5` | `#404040` | 通用边框色 |
| `--sp-input` | `#e5e5e5` | `#404040` | 输入框边框色 |
| `--sp-ring` | `#a3a3a3` | `#737373` | 聚焦环色 |

### 语义色

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--sp-destructive` | `#dc2626` | `#f87171` | 危险/错误色 |
| `--sp-success` | `#16a34a` | `#22c55e` | 成功/确认色 |
| `--sp-success-foreground` | `#ffffff` | `#052e16` | 成功色上的文字色 |
| `--sp-warning` | `#ea580c` | `#f97316` | 警告色 |
| `--sp-warning-foreground` | `#ffffff` | `#1c1917` | 警告色上的文字色 |
| `--sp-diff-added` | `#16a34a` | `#22c55e` | diff/文件查看器中新增内容 |

### 圆角

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `--sp-radius` | `0.5rem` | 全局圆角基数（Tailwind 的 `rounded-sm/md/lg/xl` 基于此派生） |

### 侧边栏

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--sp-sidebar` | `#ffffff` | `#1f1f1f` | 侧边栏背景 |
| `--sp-sidebar-foreground` | `#171717` | `#fafafa` | 侧边栏文字色 |
| `--sp-sidebar-primary` | `#171717` | `#fafafa` | 侧边栏主要操作 |
| `--sp-sidebar-primary-foreground` | `#fafafa` | `#171717` | 侧边栏主要操作文字 |
| `--sp-sidebar-accent` | `#f5f5f5` | `#262626` | 侧边栏悬停/选中 |
| `--sp-sidebar-accent-foreground` | `#171717` | `#fafafa` | 侧边栏悬停文字 |
| `--sp-sidebar-border` | `#e5e5e5` | `#404040` | 侧边栏边框 |
| `--sp-sidebar-ring` | `#a3a3a3` | `#737373` | 侧边栏聚焦环 |

## 示例

### 暖色调主题

```css
/* .spherse/theme.css */
:root {
  --sp-background: #faf8f5;
  --sp-foreground: #3d2c1e;
  --sp-primary: #8b5e34;
  --sp-primary-foreground: #faf8f5;
  --sp-accent: #f0e6d8;
  --sp-accent-foreground: #3d2c1e;
  --sp-muted: #f0e6d8;
  --sp-muted-foreground: #8a7a68;
  --sp-border: #e0d5c8;
  --sp-card: #ffffff;
  --sp-popover: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --sp-background: #1a1612;
    --sp-foreground: #e8ddd0;
    --sp-primary: #d4a574;
    --sp-primary-foreground: #1a1612;
    --sp-accent: #2d2418;
    --sp-accent-foreground: #e8ddd0;
    --sp-muted: #2d2418;
    --sp-muted-foreground: #a0917e;
    --sp-border: #3d3228;
    --sp-card: #231e18;
    --sp-popover: #231e18;
  }
}
```

### 增大圆角

```css
/* .spherse/theme.css */
:root {
  --sp-radius: 0.75rem;
}
```

## 项目面板与内容浏览器

除了聊天窗口，项目级 `.spherse/theme.css` 还可以定制项目面板和内容浏览器的背景与外观。

| 钩子 | 作用对象 |
|------|---------|
| `data-project-panel` | 项目侧边面板（agent/session 列表 + 文件树的容器，默认 `--sp-sidebar` 背景） |
| `data-content-browser` | 内容浏览器（文档/代码查看区根容器，包含 header 与内容滚动区） |

示例：

```css
/* .spherse/theme.css —— 项目面板背景图 */
[data-project-panel] {
  background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
}

/* 内容浏览器背景 */
[data-content-browser] {
  background: url('https://example.com/paper-texture.png') repeat;
}
```

> 项目面板内部使用 shadcn/ui sidebar 组件（`--sp-sidebar` 系列变量控制纯色背景）。设 `background` / `background-image` 可覆盖纯色实现图片/渐变背景。

## 全局聊天窗口默认样式

`.spherse/theme.css` 除了覆盖 UI 变量，还可以用**原生 CSS nesting** 定义全局聊天窗口的默认样式。把规则包裹在 `[data-chat-root] { ... }` 内，它会作用于**所有** agent 的聊天窗口（inline 与 floating 都生效），作为单 agent 主题覆盖之前的全局默认。

```css
/* .spherse/theme.css —— 项目级全局 chat 默认样式（作用于所有 agent 的聊天窗口） */
[data-chat-root] {
  [data-chat-bubble] { border-radius: 8px; }
  [data-chat-md-code] { background: #1a1a2e; }
}
```

> 单个 agent 想覆盖这些默认样式时，在 `agents/{slug}-{shortId}/theme.css` 里写更高优先级或相同特异性的规则即可覆盖（agent theme 在 DOM 中更靠后注入，相同特异性下胜出）。详见 `create-agent-chat-theme` skill 的「层叠关系」章节。

## 文档视图 Markdown 样式

文档视图（content browser 的文档渲染区）暴露了 `data-*` 钩子，可在 `.spherse/theme.css` 中定制其 markdown 元素外观。

可用钩子：

| 钩子 | 作用对象 |
|------|---------|
| `data-content-doc` | 文档视图容器（外层包裹） |
| `data-md-code` | 代码块（`<pre>`） |
| `data-md-code-inline` | 行内代码（`<code>`） |
| `data-md-quote` | 引用块（`<blockquote>`） |

示例：

```css
/* .spherse/theme.css —— 文档视图 markdown 样式 */
[data-content-doc] [data-md-code] { border-radius: 6px; }
[data-content-doc] [data-md-quote] { border-color: #ccc; }
```

> `data-md-code` / `data-md-quote` 这组钩子同时存在于聊天窗口与文档视图，作用域由父选择器显式表达：用 `[data-content-doc]` 限定到文档视图；用 `[data-chat-root]` 限定到聊天（见上文「全局聊天窗口默认样式」）。

## 注意事项

- 只覆盖你想修改的变量，其余保持默认
- 变量名必须与上表一致，不支持自定义变量名
- 深色模式值放在 `@media (prefers-color-scheme: dark)` 内的 `:root` 中
- 修改后刷新页面即可生效，无需重启应用
