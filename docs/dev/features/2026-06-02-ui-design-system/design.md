# UI Design System：Token 收敛与编码规范

## 背景

前端重构 1（`2026-05-30-frontend-refactor-shadcn`）已引入 shadcn/ui + Base UI 作为基础组件层，业务组件已全面使用 shadcn 语义 token（`bg-background`、`text-muted-foreground`、`border-border` 等）。但 `styles.css` 中仍保留两套并存的 CSS 变量体系：

- **shadcn 语义 token**（`--shadcn-*`）：业务组件实际使用
- **旧自定义变量**（`--surface`、`--base`、`--hover`、`--danger`、`--type-creator-*` 等）：仅存在于 `styles.css` 定义和 `@theme inline` 映射中，无业务组件引用

此外，缺少明确的样式写法规范，新开发时容易产生不一致的写法（硬编码颜色、随意间距、手写 CSS class 等）。

## 需求对齐

### 本次范围

1. 一次性删除所有旧 CSS 变量，统一使用 shadcn 语义 token 体系
2. 为 shadcn 未覆盖的场景新增 Spherse 自有 token（agent-type 色彩、成功色等），注册为 Tailwind 自定义颜色
3. 建立样式写法规范、design token 使用规范、主题/暗色模式规范
4. 更新 `docs/official/architecture.md` 和 `AGENTS.md` 中的前端样式章节

### 非目标

- 不新增业务组合组件（如 `AppDialog`、`MessageBubble`），留待后续任务
- 不新增代码文件（如 `tokens.ts` 常量导出），token 体系完全通过 CSS 变量 + Tailwind `@theme inline` 管理
- 不引入样式 lint 工具（如 `eslint-plugin-tailwindcss`），通过 code review 守住规范
- 不修改 core/server API
- 不处理 Spherse 品牌视觉重设计

## Token 体系

### 目标结构

```
styles.css
├── :root                         # 浅色值
│   ├── --radius                  # 全局圆角（shadcn 原有）
│   └── --shadcn-*                # shadcn 语义 token（保留）
│
├── @media (prefers-color-scheme: dark)
│   └── :root                     # 深色值覆盖
│
└── @theme inline                 # Tailwind 颜色注册
    └── --color-{semantic}        # shadcn 语义映射（保留）
```

### 旧变量删除与映射

以下旧变量从 `:root` 和 `@media (prefers-color-scheme: dark)` 中删除，对应的 `@theme inline` 映射也一并删除：

| 旧变量 | shadcn 替代 | 说明 |
|--------|-------------|------|
| `--surface` | `--shadcn-card` (`bg-card`) | 卡片/面板背景 |
| `--base` | `--shadcn-background` (`bg-background`) | 页面背景 |
| `--hover` | `--shadcn-accent` (`bg-accent`) | 悬停背景 |
| `--hover-strong` | `--shadcn-accent` + opacity | 可用 `bg-accent/80` |
| `--input-bg` | `--shadcn-input` (`bg-input`) | 输入框背景 |
| `--muted-bg` | `--shadcn-muted` (`bg-muted`) | 弱化背景 |
| `--code-bg` | `--shadcn-muted` (`bg-muted`) | 代码块背景 |
| `--active-bg` | `--shadcn-accent` (`bg-accent`) | 选中/激活背景 |
| `--overlay` | 删除 | 用 Tailwind `bg-black/40` 工具类 |
| `--border` | `--shadcn-border` (`border-border`) | 边框色 |
| `--border-light` | `--shadcn-border` + opacity | 弱边框 |
| `--border-input` | `--shadcn-input` (`border-input`) | 输入框边框 |
| `--primary` | `--shadcn-foreground` (`text-foreground`) | 主文字色 |
| `--secondary` | `--shadcn-muted-foreground` (`text-muted-foreground`) | 次要文字色 |
| `--muted` | `--shadcn-muted-foreground` (`text-muted-foreground`) | 弱化文字色 |
| `--faint` | `--shadcn-muted-foreground` + opacity | 极弱文字色 |
| `--on-muted` | `--shadcn-accent-foreground` (`text-accent-foreground`) | 弱化背景上的文字色 |
| `--accent` | `--shadcn-primary` (`bg-primary`) | 强调色 |
| `--accent-hover` | `--shadcn-primary` + opacity | 强调悬停色 |
| `--danger` | `--shadcn-destructive` (`text-destructive`) | 危险色 |
| `--danger-hover` | `--shadcn-destructive` + opacity | 危险悬停色 |
| `--success` | 自定义 `--agent-success` | 成功色 |
| `--shadow-card` | 删除 | 用 Tailwind `shadow-sm` |
| `--shadow-dialog` | 删除 | 用 Tailwind `shadow-xl` |

### 新增 Spherse 自有 token

本次不新增自有 token。shadcn 语义 token 已覆盖所有当前业务场景。后续如需新增（如 agent 类型标签色彩、成功状态色等），按以下规则操作：

- CSS 变量：`--agent-{name}`，在 `:root` 和 `@media (prefers-color-scheme: dark)` 中各定义一组
- Tailwind 映射：在 `@theme inline` 中添加 `--color-agent-{name}: var(--agent-{name})`
- 命名规则：`--agent-` 前缀区分于 shadcn 的 `--shadcn-*`

### `@layer base` 更新

`styles.css` 中 `@layer base` 的两处引用更新：

- `color: var(--primary)` → `color: var(--shadcn-foreground)`
- `background: var(--base)` → `background: var(--shadcn-background)`

### 自定义主题影响

用户自定义主题文件 `.spherse/theme.css` 如果覆盖了旧变量名（`--surface`、`--base` 等），在迁移后会失效。需要：

1. 在 CHANGELOG 或 release note 中注明旧变量已移除
2. 如果 `.spherse/theme.css` 存在，读取并提示用户迁移到新变量名（此功能可在后续版本中实现，本次只做文档说明）

## 编码规范

### 样式写法

**规则 1：只使用 Tailwind 工具类 + CSS 变量色彩体系**

- 禁止在 `styles.css` 中新增手写 CSS class（如 `.xxx-card`、`.xxx-section`）
- 所有样式通过 Tailwind 工具类写在组件 className 中
- 唯一例外：`@layer base` 中的全局 reset 和 `@keyframes`

**规则 2：className 组织顺序**

按以下分组顺序排列，组间用空格分隔：

```
布局 → 尺寸 → 间距 → 排版 → 背景 → 边框 → 圆角 → 阴影 → 过渡/动画 → 状态 → 响应式/暗色
```

示例：`flex h-full w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar p-4`

**规则 3：`cn()` 使用场景**

- 条件样式组合（如 `cn("bg-card", isActive && "bg-accent")`）必须用 `cn()`
- 静态 className 直接写字符串，不包裹 `cn()`

**规则 4：不硬编码颜色值**

- 禁止在 className 中写 `text-[#333]`、`bg-[#e8f5e9]` 等硬编码颜色
- 需要新颜色时，在 `styles.css` 中注册 CSS 变量 + Tailwind 颜色，然后通过 `bg-xxx` / `text-xxx` 使用
- opacity 修饰符允许：`bg-primary/80`、`text-muted-foreground/60`

### Design Token 使用

**规则 5：使用语义 token**

| 场景 | 使用 token |
|------|-----------|
| 页面背景 | `bg-background` |
| 卡片/面板 | `bg-card` |
| 弹出层 | `bg-popover` |
| 弱化/次要区域 | `bg-muted` |
| 主操作按钮 | `bg-primary` |
| 悬停/选中态 | `bg-accent` |
| 输入框背景 | `bg-input` 或 `bg-input/20` |
| 边框 | `border-border`、`border-input` |
| 主文字 | `text-foreground` |
| 次要文字 | `text-muted-foreground` |
| 危险操作 | `text-destructive`、`bg-destructive` |

**规则 6：间距使用 Tailwind 标准 scale**

- 禁止 `p-[13px]` 等 magic number
- 使用 Tailwind 标准：`p-1`(4px)、`p-2`(8px)、`p-3`(12px)、`p-4`(16px)、`p-6`(24px)
- 圆角使用 `--radius` 相关 token：`rounded-md`、`rounded-lg`

**规则 7：阴影使用 Tailwind 标准**

- 禁止 `shadow-[0_2px_12px_rgba(0,0,0,0.08)]`
- 使用 `shadow-sm`、`shadow-md`、`shadow-lg`、`shadow-xl`

### 主题 / 暗色模式

**规则 8：暗色适配方式**

- 深浅色通过 `styles.css` 的 `:root` 和 `@media (prefers-color-scheme: dark)` 中 CSS 变量值切换
- 业务组件**不写** `dark:` 前缀修饰符，由 CSS 变量自动适配
- 唯一例外：shadcn/ui 组件源码（`components/ui/`）中已有的 `dark:` 修饰符保留不动

**规则 9：用户自定义主题**

- 用户通过项目根目录 `.spherse/theme.css` 覆盖 CSS 变量
- `theme.css` 只允许覆盖 `:root` 中已有的变量名
- 主题加载机制：`useCustomTheme` hook 读取并注入，不修改全局样式文件

**规则 10：新增 token 命名规则**

- shadcn 语义 token：`--shadcn-{semantic-name}`，通过 `--color-{semantic-name}` 暴露给 Tailwind
- Spherse 自有 token：`--agent-{name}`，通过 `--color-agent-{name}` 暴露给 Tailwind

## 实施影响

### 受影响文件

| 文件 | 变更内容 |
|------|----------|
| `packages/app/src/styles.css` | 删除旧变量和 `@theme inline` 映射，新增 Spherse 自有 token，更新 `@layer base` |
| `docs/official/architecture.md` | 更新"前端样式"章节，反映收敛后的单一 token 体系 |
| `AGENTS.md` | 在"编码规范"中补充样式相关规范要点 |

### 不受影响文件

- 业务组件（`.tsx`）：已使用 shadcn 语义 token，无需改动
- shadcn/ui 组件（`components/ui/`）：无需改动
- core/server 包：无前端样式相关代码

## 后续任务

本次 design system 建立后，以下任务可独立推进：

- Spherse 品牌视觉调整（微调 shadcn 默认 token 值）
- 业务组合组件封装（`AppDialog`、`MessageBubble`、`SidebarTreeItem` 等）
- 自定义主题迁移提示功能（检测旧变量名并提示用户更新）
- 样式 lint 工具引入（如 `eslint-plugin-tailwindcss`）
