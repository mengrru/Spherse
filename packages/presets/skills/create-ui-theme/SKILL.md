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

### 滚动条

应用内所有可滚动区域（聊天消息列表、文件树、内容浏览器、下拉菜单、对话框等）统一使用细滚动条，存在感弱，可在浅色/深色下自动适配。`size` 控制宽高，`thumb` / `thumb-hover` 是滑块常态与悬停色，`track` 是轨道背景（默认透明）。

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--sp-scrollbar-size` | `10px` | `10px` | 滚动条宽度/高度 |
| `--sp-scrollbar-thumb` | `rgba(115,115,115,0.4)` | `rgba(163,163,163,0.4)` | 滑块颜色（常态） |
| `--sp-scrollbar-thumb-hover` | `rgba(115,115,115,0.65)` | `rgba(163,163,163,0.65)` | 滑块颜色（悬停） |
| `--sp-scrollbar-track` | `transparent` | `transparent` | 轨道背景 |

> 变量遵循 CSS 级联，因此可在**特定容器作用域**内覆盖，实现局部定制。例如只让聊天窗口的滚动条变色：
>
> ```css
> /* .spherse/theme.css —— 仅聊天窗口滚动条变色 */
> [data-chat-root] {
>   --sp-scrollbar-thumb: rgba(201, 160, 74, 0.6);
>   --sp-scrollbar-thumb-hover: rgba(201, 160, 74, 0.85);
> }
> ```
>
> 如需完全自定义滚动条（如不同方向不同样式、动画），直接在 `.spherse/theme.css` 中以更高优先级或相同特异性重写 `::-webkit-scrollbar` 系列伪元素规则即可（项目主题 CSS 在应用样式之后注入，相同特异性下胜出）。

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

## 应用根容器 / 全局装饰

`data-app-root` 是整个应用窗口的最外层容器，铺满视口（`100vh`，已 `position: relative` 且 `overflow: hidden`）。它是 activity bar、项目面板、主内容区、聊天窗口、浮动窗、设置弹窗、toast 等**所有可见 UI 的共同祖先**，适合用 `::before` / `::after` 或 `position: fixed` 在窗口任意位置叠加装饰层（全局背景、噪点纹理、边角装饰、水印、角标等）。

| 钩子 | 作用对象 |
|------|---------|
| `data-app-root` | 整个应用窗口的最外层容器（铺满视口，`position: relative`） |

示例：

```css
/* .spherse/theme.css —— 整窗背景（渐变 / 本地图片，相对路径基于 .spherse/ 解析） */
[data-app-root] {
  background: radial-gradient(ellipse at 20% 50%, rgba(201, 160, 74, 0.06) 0%, transparent 50%),
              linear-gradient(180deg, #0c0b12 0%, #11101a 100%);
}

/* 用 ::before 叠一层铺满窗口的装饰（纹理 / 噪点），默认位于内容之下 */
[data-app-root]::before {
  content: '';
  position: absolute;
  inset: 0;
  background: url('https://example.com/noise.png') repeat;
  opacity: 0.04;
  pointer-events: none;
  z-index: 0;
}

/* 角落装饰：左上角的角标 / 印章 */
[data-app-root]::after {
  content: '';
  position: absolute;
  top: 12px;
  inset-inline-start: 12px;
  width: 64px;
  height: 64px;
  background: url('./assets/corner-mark.png') no-repeat center / contain;
  opacity: 0.5;
  pointer-events: none;
}

/* 覆盖在所有内容之上的固定层（如水印），需要显式抬高 z-index */
[data-app-root] > .my-watermark {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
}
```

> - `[data-app-root]` 已是定位上下文，`::before` / `::after` 默认已被应用设为 `position: absolute; pointer-events: none`（相对整窗定位、不挡交互），因此**只需写装饰属性即可**，漏写也不会进入 flex 流导致整窗偏移；如需固定层（`position: fixed`）或可交互叠层（`pointer-events: auto`），显式覆盖即可。`overflow: hidden` 会自动裁剪超出窗口的部分。
> - 装饰默认处于内容之下：内容区的背景多为半透明或 `--sp-background`，叠在最外层根容器上的装饰会从内容半透明处透出。若要让装饰**盖在内容之上**，给伪元素或固定层显式设较高的 `z-index` 并加 `pointer-events: none`，避免遮挡交互。
> - 本地图片用相对路径（`url('./assets/x.png')` 基于项目 `.spherse/` 目录解析），或远程 URL（项目主题同样以 `<link>` 从 preview 路由载入，相对 `url()` 解析到项目文件）。

## Activity Bar 项目头像

应用最左侧 activity bar 上的项目头像暴露了语义钩子，可在项目级 `.spherse/theme.css` 中定制其外观（背景、边框、圆角、选中/未选中态等）。

| 钩子 | 作用对象 |
|------|---------|
| `data-project-avatar` | 项目头像根容器（含 fallback 字母） |
| `[data-project-avatar][data-active]` | 当前选中项目的头像（`data-active` 仅在选中态存在） |

示例：

```css
/* .spherse/theme.css —— 项目头像自定义背景与圆角 */
[data-project-avatar] {
  background: var(--sp-primary);
  color: var(--sp-primary-foreground);
  border-radius: 9999px;
}

/* 选中态加描边，未选中态降低透明度 */
[data-project-avatar][data-active] {
  outline: 2px solid var(--sp-primary);
}
[data-project-avatar]:not([data-active]) {
  opacity: 0.4;
}
```

> 头像默认选中态为 `opacity-100`、未选中态为 `opacity-30`，均通过 class 而非 inline style 控制，可被相同或更高特异性的主题规则覆盖。

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

## 浮窗内容浏览器

从文件树右键「浮窗」打开的浮动内容窗口暴露了 `data-content-float-*` 钩子，可在 `.spherse/theme.css` 中定制窗口外观。

可用钩子：

| 钩子 | 作用对象 |
|------|---------|
| `data-content-float-root` | 浮窗根容器（`position: fixed`）。定制 border、border-radius、box-shadow、background、backdrop-filter |
| `data-content-float-titlebar` | 标题栏（文件名 + 关闭按钮）。定制 background、text color、padding |
| `data-content-float-close` | 关闭按钮。定制图标颜色、hover 态 |

示例：

```css
/* .spherse/theme.css —— 浮窗内容浏览器样式 */
[data-content-float-root] {
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
[data-content-float-root] [data-content-float-titlebar] {
  background: var(--sp-muted);
}
[data-content-float-root] [data-content-float-close]:hover {
  background: var(--sp-destructive);
  color: white;
}
```

## 浮窗简易浏览器

点击 localhost 链接（或在地址栏输入本地地址）打开的浮动简易浏览器窗口暴露了 `data-browser-float-*` 钩子，可在 `.spherse/theme.css` 中定制窗口外观（页签与浮窗共用同一套钩子）。

可用钩子：

| 钩子 | 作用对象 |
|------|---------|
| `data-browser-float-root` | 浮窗根容器（`position: fixed`）。定制 border、border-radius、box-shadow、background、backdrop-filter |
| `data-browser-float-titlebar` | 标题栏（地址 + 工具栏按钮）。定制 background、text color、padding |
| `data-browser-float-close` | 关闭按钮。定制图标颜色、hover 态 |

示例：

```css
/* .spherse/theme.css —— 浮窗简易浏览器样式 */
[data-browser-float-root] {
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
[data-browser-float-root] [data-browser-float-titlebar] {
  background: var(--sp-muted);
}
[data-browser-float-root] [data-browser-float-close]:hover {
  background: var(--sp-destructive);
  color: white;
}
```

## 全局聊天窗口默认样式

`.spherse/theme.css` 除了覆盖 UI 变量，还可以用**原生 CSS nesting** 定义全局聊天窗口的默认样式。把规则包裹在 `[data-chat-root] { ... }` 内，它会作用于**所有** agent 的聊天窗口（inline 与 floating 都生效），作为单 agent 主题覆盖之前的全局默认。

```css
/* .spherse/theme.css —— 项目级全局 chat 默认样式（作用于所有 agent 的聊天窗口） */
[data-chat-root] {
  [data-chat-bubble] { border-radius: 8px; }
  [data-chat-md-code] { background: #1a1a2e; }
}
```

> 单个 agent 想覆盖这些默认样式时，在 `agents/{agent-slug}/theme.css` 里写更高优先级或相同特异性的规则即可覆盖（agent theme 在 DOM 中更靠后注入，相同特异性下胜出）。详见 `create-agent-chat-theme` skill 的「层叠关系」章节。

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

## 全局 Toast

全局 toast（`sonner` 渲染的右下角通知）在应用侧暴露了一个语义入口 `data-toast-root`，作为项目级主题定制 toast 外观的稳定锚点。该容器包裹 sonner 的 `position: fixed` 视口层（所有 toast 的定位层），用 `display: contents` 修饰，不参与应用布局。

| 钩子 | 作用对象 |
|------|---------|
| `data-toast-root` | 全局 toast 视口容器（包裹 sonner 的 `<ol data-sonner-toaster>`，本身 `position: fixed`） |

toast 内部各部分由 sonner 渲染，暴露的是库自有的稳定 `data-*` 属性，用 `[data-toast-root]` 作前缀做后代选择器即可精准定制：

| 子目标选择器 | 作用对象 |
|------|---------|
| `[data-toast-root] [data-sonner-toast]` | 单条 toast（`<li>`） |
| `[data-toast-root] [data-type="success"]` | success 类型变体（`error`/`warning`/`info`/`loading` 同理） |
| `[data-toast-root] [data-title]` | toast 标题文本 |
| `[data-toast-root] [data-description]` | toast 描述文本 |
| `[data-toast-root] [data-close-button]` | 关闭按钮 |
| `[data-toast-root] [data-content]` | 标题+描述的内容包裹 |
| `[data-toast-root] [data-y-position]` / `[data-x-position]` | 按屏幕位置区分（如顶部/底部、左/右） |

## 注意事项

- 只覆盖你想修改的变量，其余保持默认
- 变量名必须与上表一致，不支持自定义变量名
- 深色模式值放在 `@media (prefers-color-scheme: dark)` 内的 `:root` 中
- 修改后刷新页面即可生效，无需重启应用
