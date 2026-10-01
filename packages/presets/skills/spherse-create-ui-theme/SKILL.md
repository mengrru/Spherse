---
name: spherse-create-ui-theme
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

## 钩子与作用域

- 共享交互组件使用 Base UI，不是 Radix。
- 以语义 `data-*` 钩子和 `data-slot` 为样式入口，具体对象与状态见各节，可自由组合 CSS 定制外观。
- Portal 浮层位于触发位置的 DOM 层级之外，用自身钩子定制；全局配色放在 `:root`，便于主布局与浮层共同继承。

## 应用根容器 / 全局装饰

`data-app-root` 是应用主布局的根容器，铺满视口（`100vh`，已 `position: relative` 且 `overflow: hidden`），包含 activity bar、项目面板、主内容区与内嵌聊天窗口。它适合用 `::before` / `::after` 叠加全局背景、噪点纹理、边角装饰等，但**不是所有可见 UI 的 DOM 共同祖先**：通过 Portal 渲染的对话框、菜单、提示与聊天浮窗等位于其外部，需用各自的钩子定制。

| 钩子 | 作用对象 |
|------|---------|
| `data-app-root` | 应用主布局根容器（铺满视口，`position: relative`；不包含外部 Portal 浮层） |

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

/* 主布局内的固定装饰层（如水印），层级仍受祖先堆叠上下文约束 */
[data-app-root] > .my-watermark {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
}
```

> - `[data-app-root]` 已是定位上下文，`::before` / `::after` 默认已被应用设为 `position: absolute; pointer-events: none`（相对整窗定位、不挡交互），因此**只需写装饰属性即可**，漏写也不会进入 flex 流导致整窗偏移；如需固定层（`position: fixed`）或可交互叠层（`pointer-events: auto`），显式覆盖即可。`overflow: hidden` 会自动裁剪超出窗口的部分。
> - 装饰默认处于内容之下：内容区的背景多为半透明或 `--sp-background`，叠在最外层根容器上的装饰会从内容半透明处透出。若要让装饰**盖在内容之上**，给伪元素或固定层显式设较高的 `z-index` 并加 `pointer-events: none`，避免遮挡交互。
> - 根容器内的高 `z-index` 不保证盖过外部 Portal 浮层；不要通过改变应用根的 `transform` / `filter` 等属性来假设所有浮层会一起定位或装饰。
> - 本地图片用相对路径（`url('./assets/x.png')` 基于项目 `.spherse/` 目录解析），或远程 URL（项目主题同样以 `<link>` 从 preview 路由载入，相对 `url()` 解析到项目文件）。

## 侧边区域

| 钩子 | 作用对象 |
|------|---------|
| `data-activity-bar` | 项目切换栏。定制背景、边框与内部间距 |
| `data-side-panel` | 桌面侧边区域，包含项目切换栏与项目面板 |
| `data-side-panel-drawer` | 移动端侧边抽屉，包含项目切换栏与项目面板 |

桌面容器与移动端抽屉是不同渲染分支，不是嵌套关系；抽屉遮罩是独立的兄弟元素，不在 `data-side-panel-drawer` 内。面板隐藏通过 `inert` 与位移处理，没有专用的 `data-open` / `data-pinned` 属性，定制时保留定位与收起动画。

`data-activity-bar` 的外层还独立保留了 52px 宽度，只修改该钩子的宽度不会同步改变布局占位。侧边区域内部各面板有自己的背景，修改外层背景不一定可见。

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
| `data-tab-bar` | 内容区标签栏（位于内容区左栏最上方，开启分窗时不跨越右侧分窗；用户可在设置中关闭；默认 `bg-muted/40` + 底边框） |
| `data-tab`（值为 `welcome` / `chat` / `file` / `browser`，活跃项带 `data-active="true"`） | 标签栏中的单个标签（活跃标签默认 `--sp-background` 背景） |
| `data-tab-drop-indicator` | 拖拽排序时插入位置的竖线指示条（仅拖拽悬停时存在，默认 `--sp-primary` 色、贴标签起始边） |
| `data-split-layout` | 内容区横向容器（包住左栏、分隔条与右侧分窗） |
| `data-split-main` | 内容区左栏（标签栏 + 当前页面；无分窗时占满内容区） |
| `data-split-divider` | 左右分窗之间的可拖拽分隔条（默认 1px `--sp-border`，拖动中带 `data-dragging`） |
| `data-split-pane` | 右侧分窗（内部内容浏览器根仍为 `data-content-browser`，对 `[data-content-browser]` 的定制同样生效；可用 `[data-split-pane] [data-content-browser]` 单独定制分窗） |

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

/* 标签栏与活跃标签 */
[data-tab-bar] {
  background: #16213e;
}
[data-tab][data-active="true"] {
  background: #1a1a2e;
  color: #f4d35e;
}
```

 > 项目面板内部使用 shadcn/ui sidebar 组件（`--sp-sidebar` 系列变量控制纯色背景）。设 `background` / `background-image` 可覆盖纯色实现图片/渐变背景。

### 标签栏定制

标签默认是直角矩形，仅靠右侧边框分隔；形状、间距、活跃态都可在 `.spherse/theme.css` 中改写。项目主题以无层（unlayered）CSS 注入，普通选择器即可覆盖应用内置的 Tailwind 样式，无需 `!important`。

```css
/* 圆角「胶囊」标签 + 活跃态渐变与下划线 */
[data-tab-bar] {
  gap: 4px;
  padding: 4px 6px 0;
  border-bottom: none;
}
[data-tab] {
  border: none;
  border-radius: 8px 8px 0 0;
}
[data-tab][data-active="true"] {
  background: linear-gradient(180deg, #ffffff, #f3e8ff);
  box-shadow: inset 0 -2px 0 #a855f7;
}
[data-tab]::after {
  content: "";
  position: absolute;
  inset: auto 8px 0;
  height: 2px;
  border-radius: 1px;
  background: transparent;
  transition: background 0.2s;
}
[data-tab]:hover::after { background: #d8b4fe; }

/* 按类别区分颜色 */
[data-tab="chat"] { color: #2563eb; }
[data-tab="file"] { color: #059669; }

/* 拖拽指示条 */
[data-tab-drop-indicator] { width: 3px; border-radius: 2px; background: #a855f7; }
```

注意事项：

- **纵向会被裁剪**：标签栏固定高度（约 36px）且纵向 `overflow: hidden`（横向可滚动）。向外的投影、`transform: translateY` 上浮等超出标签栏上下边界的效果会被裁掉——优先用 inset 阴影、内边距；确需外溢时同时覆盖 `[data-tab-bar]` 的 `height` / `padding`
- **伪元素可自由使用**：`[data-tab]` 自身是定位上下文（`position: relative`），`::before` / `::after` 均未被占用，装饰伪元素记得写 `position: absolute`，避免挤压标签内容
- **标签内部元素无专属钩子**：文字按钮与关闭按钮暂未暴露 `data-*` 钩子，如需微调只能用 `[data-tab] > button` 之类的结构选择器，应用更新时可能失效，尽量只在 `[data-tab]` 层定制
- **欢迎页标签**：`[data-tab="welcome"]` 固定在首位且无关闭按钮，可用该选择器单独设计
- 标签栏在聊天窗口之外，**agent 主题不影响它**，只能在项目级 `.spherse/theme.css` 定制

## 设置页签（Tabs）

设置与 Agent 编辑表单使用共享 Tabs 组件，与上文文档/会话标签栏的 `[data-tab]` 不是同一套钩子。

| 选择器 | 作用对象 |
|--------|---------|
| `[data-slot="tabs"]` | 页签组根容器 |
| `[data-slot="tabs-list"]` | 页签按钮列表 |
| `[data-slot="tabs-trigger"]` | 单个页签按钮 |
| `[data-slot="tabs-trigger"][data-active]` | 当前选中的页签按钮 |
| `[data-slot="tabs-content"]` | 页签内容面板 |

选中态使用 `[data-active]`，不是 `[data-active="true"]` 或 `[data-state="active"]`。列表的 `data-variant="line"` 变体使用按钮的 `::after` 作为指示线，定制伪元素时避免覆盖它。

## 对话框（Dialog）

使用共享 Dialog 组件的对话框通过 `data-slot` 暴露样式入口，没有额外的 `data-dialog-*` 钩子。可在项目级 `.spherse/theme.css` 中用以下选择器统一定制：

| 选择器 | 作用对象 |
|--------|---------|
| `[data-slot="dialog-content"]` | 弹窗主体。定制 background、text color、border-radius、box-shadow |
| `[data-slot="dialog-overlay"]` | 背景遮罩。定制 background、backdrop-filter |
| `[data-slot="dialog-header"]` | 头部。定制间距与布局 |
| `[data-slot="dialog-title"]` | 标题。定制字体与颜色 |
| `[data-slot="dialog-description"]` | 描述文字。定制字体与颜色 |
| `[data-slot="dialog-footer"]` | 底部操作区。定制间距与布局 |
| `[data-slot="dialog-close"]` | 关闭按钮。定制图标颜色、hover 态 |
| `[data-slot="dialog-trigger"]` | 使用 DialogTrigger 的打开弹窗触发元素 |

弹窗主体默认使用 `--sp-popover` / `--sp-popover-foreground` 配色（见「弹出层」变量表）。这些选择器会匹配所有使用对应组件的对话框，不仅是主题设置弹窗。

Dialog 的主体与遮罩通过 Portal 渲染，不保留触发位置的 DOM 祖先关系。请直接使用上述选择器，不要依赖 `[data-chat-root]` 或触发按钮所在面板作为祖先；遮罩也不在 `[data-slot="dialog-content"]` 内，需单独选择。

## 确认弹窗（AlertDialog）

删除确认等使用独立的 AlertDialog 组件，`dialog-*` 选择器不会匹配它。

| 选择器 | 作用对象 |
|--------|---------|
| `[data-slot="alert-dialog-content"]` | 确认弹窗主体 |
| `[data-slot="alert-dialog-overlay"]` | 背景遮罩 |
| `[data-slot="alert-dialog-header"]` | 头部 |
| `[data-slot="alert-dialog-title"]` | 标题 |
| `[data-slot="alert-dialog-description"]` | 描述文字 |
| `[data-slot="alert-dialog-footer"]` | 底部操作区 |
| `[data-slot="alert-dialog-action"]` | 确认按钮 |
| `[data-slot="alert-dialog-cancel"]` | 取消按钮 |

主体默认使用 `--sp-popover` / `--sp-popover-foreground`，并带有 `data-size="default"` 或 `data-size="sm"`。主体与遮罩通过 Portal 渲染，遮罩不在主体内部，需单独选择。

## 提示与气泡（Tooltip / Popover）

| 选择器 | 作用对象 |
|--------|---------|
| `[data-slot="tooltip-trigger"]` | Tooltip 提示的触发元素 |
| `[data-slot="tooltip-content"]` | Tooltip 提示内容 |
| `[data-slot="popover-trigger"]` | Popover 气泡的触发元素，不一定是按钮 |
| `[data-slot="popover-content"]` | Popover 气泡内容，如 Agent 编辑中的文件建议列表 |

两类内容都通过 Portal 渲染；内容的开关状态用 `[data-open]` / `[data-closed]`，方向可用 `[data-side="top"]` 等属性，触发元素打开时带 `[data-popup-open]`。不要使用 `data-state="delayed-open"` 等其他组件库的状态约定。

Popover 默认使用 `--sp-popover` / `--sp-popover-foreground`；Tooltip 则使用 `--sp-foreground` 背景与 `--sp-background` 文字。Tooltip 箭头单独使用 foreground 配色且没有专用 `data-slot`，只改内容背景不会同步改变箭头颜色。

这些入口仅覆盖共享 Tooltip / Popover 组件，不覆盖原生 `title` 提示或自定义浮层（如文本选择后的发起会话面板）。保留浮层定位所需的尺寸约束与 `--anchor-width` 等变量。

## 搜索入口

| 钩子 | 作用对象 |
|------|---------|
| `data-global-search-dialog` | 全局搜索弹窗主体，可单独定制而不影响其他 Dialog |
| `data-content-findbar` | 文档内查找工具栏，可定制背景、边框与间距 |

`data-global-search-dialog` 与 `data-slot="dialog-content"` 位于同一元素，不是祖先与后代。它遵循 Dialog 的 Portal 规则，遮罩没有此钩子；搜索结果目前没有专用的选中态主题钩子，不要把内部 `data-search-index` 当作选中状态。

查找工具栏仅在支持查找的内容视图打开查找时出现，位于内容滚动区上方、`data-content-doc` 之外。可用 `[data-content-browser] [data-content-findbar]` 限定作用域；它只控制工具栏，不控制正文中的匹配高亮。

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

## 聊天浮窗

聊天浮窗暴露了 `data-chat-float-*` 钩子，可在项目级 `.spherse/theme.css` 中统一定制所有聊天浮窗的外框、标题栏与关闭按钮。

| 钩子 | 作用对象 |
|------|---------|
| `data-chat-float-root` | 浮窗根容器（`position: fixed`）。定制 border、border-radius、box-shadow、background、backdrop-filter |
| `data-chat-float-titlebar` | 可拖动标题栏。定制 background、text color、padding |
| `data-chat-float-close` | 关闭按钮。定制图标颜色、hover 态 |

浮窗内的聊天内容位于 `[data-chat-root]` 中，但外框、标题栏与关闭按钮在它之外。因此浮窗外观规则必须在文件**顶层**以 `[data-chat-float-root]` 为作用域，不要嵌套在 `[data-chat-root]` 内。

聊天内容的全局默认样式见下一节；agent 主题中的浮窗写法见 `spherse-create-agent-chat-theme` skill 的「浮动窗口（Floating Chat）」章节。

## 全局聊天窗口默认样式

`.spherse/theme.css` 除了覆盖 UI 变量，还可以用**原生 CSS nesting** 定义全局聊天窗口的默认样式。把规则包裹在 `[data-chat-root] { ... }` 内，它会作用于**所有** agent 的聊天窗口（inline 与 floating 都生效），作为单 agent 主题覆盖之前的全局默认。

```css
/* .spherse/theme.css —— 项目级全局 chat 默认样式（作用于所有 agent 的聊天窗口） */
[data-chat-root] {
  [data-chat-bubble] { border-radius: 8px; }
  [data-md-code] { background: #1a1a2e; }
}
```

> 单个 agent 想覆盖这些默认样式时，在 `agents/{agent-slug}/theme.css` 里写更高优先级或相同特异性的规则即可覆盖（agent theme 在 DOM 中更靠后注入，相同特异性下胜出）。详见 `spherse-create-agent-chat-theme` skill 的「层叠关系」章节。

## 文档视图 Markdown 样式

文档视图（content browser 的文档渲染区）暴露了 `data-*` 钩子，可在 `.spherse/theme.css` 中定制其 markdown 元素外观。

可用钩子：

| 钩子 | 作用对象 |
|------|---------|
| `data-content-doc` | 文档视图容器（外层包裹） |
| `data-md-code` | 代码块（`<pre>`） |
| `data-md-code-inline` | 行内代码（`<code>`） |
| `data-md-quote` | 引用块（`<blockquote>`） |
| `data-md-img` | Markdown 图片（`<img>`） |

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
