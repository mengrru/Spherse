# 主题与样式

> 覆盖：`--sp-*` token 体系架构、三级主题层叠与注入链、可主题化 DOM 入口、模板与 skill 同步契约。
> 日常样式编码规则（Tailwind 用法、语义 token、RTL、portal 约束）见 `packages/app/README.md`「样式」，本文不重复。
> 变更 DOM 入口 / 聊天布局 / token 时须同步 presets 下模板与两个 theme skill（见「同步契约」节）。

## token 体系

- 所有 design token 统一 `--sp-*` 命名空间，定义在 `styles.css` 的 `:root`；暗色模式用 `@media (prefers-color-scheme: dark)` 对色板类 token 整套同名覆盖——纯 OS 偏好驱动，全仓库不挂 `.dark` class
- 组件 Tailwind 类名（`bg-background` 等）**不动**：Tailwind v4 `@theme inline` 桥接层（`--color-background: var(--sp-background)`）解析到源变量，与命名解耦
- token 分组：背景/容器、主色/交互、弱化、边框/输入/ring、状态（destructive / success / warning / diff-added）、sidebar 族、圆角与滚动条——全量清单见 `styles.css` 与 `spherse-create-ui-theme` skill
- 新增业务 token 的注册方式：`:root` 加 `--sp-{name}` + `@theme inline` 加 `--color-{name}` 映射
- 暗色适配契约：业务组件不写 `dark:` 修饰符（shadcn 源码保留的 `dark:` 因无 `.dark` class 而惰性）

## 三级主题层叠

| 级 | 文件 | 注入方式 | 作用域 |
|---|---|---|---|
| ① App defaults | `styles.css` `:root` | 构建内联 | 全局 |
| ② Project theme | `.spherse/theme.css` | `<link>` 挂 `document.head` | 全局 UI 变量 + chat 默认样式双角色 |
| ③ Agent theme | `.spherse/agents/{slug}/theme.css` | `<link>` 渲染在 chat 容器内 | 当前 agent 的聊天窗口 |

- 优先级实现是纯 DOM 顺序：相同特异性下后载入者胜出——agent theme 的 `<link>` 在 body 内，自然覆盖 project theme 的 chat 规则
- 两级用户主题（②③）均从 preview 路由以 `<link>` 载入：相对 `url()` 引用的图片/字体按 theme.css 自身 URL 解析（project → `.spherse/`，agent → agent 目录），项目内资源可直接引用

## project theme 注入链

- `useCustomTheme`（挂 ProjectScope）：`<link id="custom-theme-link">` 挂 head，`?t=` 时间戳破缓存；重载 = 移除旧 link 再 append
- fs-watch 严格匹配 `.spherse/theme.css` → remount `<link>`——UI 保存、外部编辑器、LLM 工具修改三种来源统一生效；重连补偿重挂
- `ThemeQueryBridge` 独立负责把同一事件失效为设置 dialog 的 query 缓存（与 `<link>` 无关）
- `data-app-root`（整窗根容器）：base 层把 `::before` / `::after` 预设为 `position: absolute` + `pointer-events: none`，供项目主题叠全局装饰（背景纹理、角标、水印）

## agent theme 注入链

- `useAgentTheme`：href 经 `getPreviewUrl('.spherse/agents/{slug}/theme.css')` + `?v=<ts>` 破缓存；`Chat` 统一渲染 `<link>`——inline 与 floating chat 共用
- fs-watch 命中 agent theme 变更 → 250ms debounce → 换 href 触发重拉；重连补偿同路径
  - 服务端 watch 类别是单层 glob `.spherse/agents/*/theme.css`；客户端过滤为 `includes("agents/") && endsWith("theme.css")`（事件源已被服务端过滤，实际无害）
- **原生 CSS nesting 约定**：全部规则嵌套于顶层 `[data-chat-root] { ... }`（变量与 background 也写在块内），浏览器原生处理嵌套与 `@media`；暗色适配在块内嵌 `@media (prefers-color-scheme: dark)`
- 单独定制浮动窗 chrome：文件顶层再加独立 `[data-chat-float-root] { ... }` 块（floating 的 chat-root 嵌套在 float-root 内，两个块都命中）

## 可主题化 DOM 入口

| 钩子 | 定义位置 | 用途 |
|---|---|---|
| `data-app-root` | `App.tsx` / GlobalErrorBoundary | 整窗根，全局装饰锚点 |
| `data-chat-root` | `features/chat/index.tsx` | 聊天窗口根（agent theme 作用域） |
| `data-chat-header` / `-messages` / `-message[data-role]` / `-bubble` | Header / MessageList / MessageItem | 聊天结构四层 |
| `data-chat-composer` / `-composer-input` | Composer | 输入区外层与外框 |
| `data-chat-float-root` / `-titlebar` / `-close` | FloatingFrame（动态 `data-{prefix}-float-*`） | 浮窗 chrome，前缀 chat / browser / content 三实例 |
| `data-md-code` / `data-md-code-inline` / `data-md-quote` / `data-md-img` | CodeBlock / MarkdownContent | Markdown 元素（chat 与 document 视图共用，作用域由主题作者用父选择器表达） |
| `data-content-doc` | ContentView | 文档视图容器 |
| `data-project-panel` / `data-content-browser` | project-panel / content-browser | 两大面板区域 |
| `data-toast-root` | `components/ui/sonner.tsx` | 全局 toast 视口锚点 |
| `data-project-avatar`（+ `data-active`） | ProjectAvatar | activity bar 项目头像 |

部分钩子有 structure 测试守卫（Header / ProjectPanel / sonner / CodeBlock 等）。

## 主题设置 UI

- **项目主题**：项目头像右键 → ThemeSettingsDialog 编辑 CSS 文本；GET / PUT `settings/theme`（缺失返回空串）→ 写盘 → fs-watch 双路生效（`<link>` 重挂 + dialog 缓存失效）
- **agent 主题**：Agent Dialog 主题 tab；create / update 携 `themeContent`（仅显式提供才写文件）

## toast 主题化（特例）

sonner 在运行时注入**无层（unlayered）CSS**，按 Cascade Layers 规则永远赢过 `@layer` 内的 Tailwind 工具类：

- 修复形态：`styles.css` 用无层 + 高特异性规则把 sonner 的 `--normal-bg/text/border` 重定向到 `--sp-*`，让 sonner 自身机制产出主题色
- 用户 theme 仍可经 `[data-toast-root]` 前缀 + sonner 原生后代选择器覆盖

## 同步契约

变更 DOM 入口、聊天布局或新增可主题化选择器 / token 时，必须同步：

1. `packages/presets/templates/agent-theme-template.css`（经 sync 脚本生成常量）
2. `packages/presets/skills/spherse-create-agent-chat-theme/SKILL.md`（agent 级选择器手册）
3. `packages/presets/skills/spherse-create-ui-theme/SKILL.md`（项目级变量与区域选择器手册）

## 已知事项

- 两条 theme href 构造路径不统一：project theme 手写 URL + `?t=`，agent theme 走 `getPreviewUrl` + `?v=`——语义等价（preview 路由 + 时间戳破缓存），实现各自维护
- `@custom-variant dark`（styles.css 定义的 `.dark` class 变体）是死配置：全仓库无人挂 `.dark` class，暗色完全依赖 `prefers-color-scheme`
- `AGENT_THEME_TEMPLATE` 常量经 sync 脚本生成并导出，但当前无运行时消费方——模板仅作为参考物料存在
