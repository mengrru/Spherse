# Feature: 自定义主题体验优化

> Date: 2026-06-26
> Status: Design (revised)

## 背景

Spherse 有两层用户可写的 CSS 主题系统：

1. **项目级 UI 主题**（`.spherse/theme.css`）— 覆盖全局 app shell 的 CSS 变量
2. **Agent 聊天主题**（`.spherse/agents/{slug}-{shortId}/theme.css`）— 限定作用域、定制单个 agent 的聊天窗口外观

项目级主题通过 `<link>` 注入全局 CSS（可覆盖 `:root` 及任意选择器）；agent 主题通过自写的 `scopeCss`（`packages/app/src/lib/scope-css.ts`）把用户 CSS 改写后注入 `[data-chat-root]` 作用域。已有 hot-reload（项目级）和 fs-watch 白名单（已扩展至 `agentTheme`）。但仍存在四类体验问题：

- **Token 命名泄漏第三方库名**：用户面对的变量全是 `--shadcn-*`（shadcn/ui 的内部约定），既无法表达「这是 Spherse 的 token」，也让用户一头雾水。
- **聊天主题不支持 dark mode**：`scopeCss` 遇到 `@media` 整块 passthrough，不对其内部选择器加 `[data-chat-root]` 前缀，导致聊天主题里写暗色 `@media` 块要么命中全局、要么失效。skill 文档与模板也完全没示范这个模式。
- **聊天主题不会自动重载**：虽然 fs-watcher 已经把 `agentTheme` 加入白名单（`.spherse/agents/*/theme.css` 变更会推送 fs-watch 事件），但 renderer 端的 `useAgentTheme` 没有订阅这个事件，用户改完主题必须重开 chat/floating 窗口才能看到效果。
- **`scopeCss` 自造作用域方案过于复杂且脆弱**：这个 46 行逐行 + 花括号深度计数的解析器引入大量 gotcha（用户不能写 `[data-chat-root] {…}`、裸声明必须单行、多行声明被误处理），且 floating chat 需要另一套 scope。Electron 跑在现代 Chromium 上，已原生支持 CSS nesting（Chrome 112+），完全可以用标准语法替代。

另外发现两处 **token 引用 bug**：`content-browser/Header.tsx:62` 用了 `text-agent-success`，`--agent-success` 从未被定义；`bg-agent-creator`（AGENTS.md 里举例用）也从未定义。

同时本次一并补齐一项缺失能力：**项目级主题支持文档视图的 markdown 样式自定义**（当前 `DOCUMENT_COMPONENTS` 无任何 `data-*` 钩子，用户无法定制文档视图的 code/blockquote 等 markdown 元素外观）。

## 需求

- 将所有 design token 重命名到 Spherse 自有命名空间（`--sp-*`），消除 `--shadcn-*` 前缀，并补齐缺失的语义 token
- 废弃 `scopeCss`，改用原生 CSS nesting 表达聊天主题作用域——一次性解决 dark mode 失效、多套 scope、解析器脆弱等问题
- 聊天主题文件变更后自动重载（renderer 端订阅 fs-watch bus，复用已验证的管道）
- 补齐聊天窗口与文档视图的 `data-*` 钩子，去除脆弱的位置选择器，同时保持现有钩子名字不变（项目未上线，不做向前兼容）
- 项目级主题支持文档视图 markdown 样式自定义

## 方案

### 1. Token 重命名（`--shadcn-*` / `--agent-*` → `--sp-*`）

**命名规范**：所有 design token 统一使用 `--sp-` 前缀（Spherse 自有命名空间）。

**关键点**：组件里的 Tailwind 类名（`bg-background`、`text-foreground` 等）**不动** —— 它们通过 `@theme inline` 桥接层（`--color-background: var(--sp-background)`）解析，与源变量名解耦。因此重命名只触及：

- `packages/app/src/styles.css`（`:root`、dark `@media`、`@theme inline` 桥接、`@layer base`）
- 引用了 `agent-*` token 的少数组件
- 两个 skill 文档与模板

#### 1.1 Token 映射表

源 token（`styles.css:6-101`）→ 新 token：

**语义 token（页面/交互/文本/边框）**

| 当前 | 新名 | 默认值（light） |
|------|------|----------------|
| `--shadcn-background` | `--sp-background` | `#fafafa` |
| `--shadcn-foreground` | `--sp-foreground` | `#171717` |
| `--shadcn-card` | `--sp-card` | `#ffffff` |
| `--shadcn-card-foreground` | `--sp-card-foreground` | `#171717` |
| `--shadcn-popover` | `--sp-popover` | `#ffffff` |
| `--shadcn-popover-foreground` | `--sp-popover-foreground` | `#171717` |
| `--shadcn-primary` | `--sp-primary` | `#171717` |
| `--shadcn-primary-foreground` | `--sp-primary-foreground` | `#fafafa` |
| `--shadcn-secondary` | `--sp-secondary` | `#f5f5f5` |
| `--shadcn-secondary-foreground` | `--sp-secondary-foreground` | `#171717` |
| `--shadcn-muted` | `--sp-muted` | `#f5f5f5` |
| `--shadcn-muted-foreground` | `--sp-muted-foreground` | `#737373` |
| `--shadcn-accent` | `--sp-accent` | `#f5f5f5` |
| `--shadcn-accent-foreground` | `--sp-accent-foreground` | `#171717` |
| `--shadcn-destructive` | `--sp-destructive` | `#dc2626` |
| `--shadcn-border` | `--sp-border` | `#e5e5e5` |
| `--shadcn-input` | `--sp-input` | `#e5e5e5` |
| `--shadcn-ring` | `--sp-ring` | `#a3a3a3` |

**Sidebar token**

| 当前 | 新名 |
|------|------|
| `--shadcn-sidebar` | `--sp-sidebar` |
| `--shadcn-sidebar-foreground` | `--sp-sidebar-foreground` |
| `--shadcn-sidebar-primary` | `--sp-sidebar-primary` |
| `--shadcn-sidebar-primary-foreground` | `--sp-sidebar-primary-foreground` |
| `--shadcn-sidebar-accent` | `--sp-sidebar-accent` |
| `--shadcn-sidebar-accent-foreground` | `--sp-sidebar-accent-foreground` |
| `--shadcn-sidebar-border` | `--sp-sidebar-border` |
| `--shadcn-sidebar-ring` | `--sp-sidebar-ring` |

**Spherse 业务 token**

| 当前 | 新名 | 说明 |
|------|------|------|
| `--agent-diff-added` | `--sp-diff-added` | diff/file viewer 用 |
| _(新增)_ | `--sp-success` | 替换引用了未定义 `--agent-success` 的地方 |
| _(新增)_ | `--sp-success-foreground` | 与 success 配对 |
| _(新增)_ | `--sp-warning` | 预留语义 token |
| _(新增)_ | `--sp-warning-foreground` | 与 warning 配对 |

**Radius**

| 当前 | 新名 |
|------|------|
| `--radius` | `--sp-radius` |

Tailwind 半径 scale（`--radius-sm/md/lg/xl`）保留 Tailwind 约定名不变，仅改为引用新源：`--radius-lg: var(--sp-radius)`。

#### 1.2 Tailwind 桥接层

`@theme inline` 中的 `--color-*` 输出名不变（Tailwind 约定），只改右侧引用：

```css
@theme inline {
  --radius-sm: calc(var(--sp-radius) - 4px);
  --radius-md: calc(var(--sp-radius) - 2px);
  --radius-lg: var(--sp-radius);
  --radius-xl: calc(var(--sp-radius) + 4px);

  --color-background: var(--sp-background);
  --color-foreground: var(--sp-foreground);
  /* ... 其余 --color-* 同理 ... */

  --color-success: var(--sp-success);
  --color-success-foreground: var(--sp-success-foreground);
  --color-warning: var(--sp-warning);
  --color-warning-foreground: var(--sp-warning-foreground);
  --color-diff-added: var(--sp-diff-added);
}
```

**新增 `--color-success` / `--color-warning`** 后，业务组件可用 `text-success` / `bg-warning` 等 Tailwind 类（替换原先引用幽灵 token 的地方）。

#### 1.3 修复幽灵 token 引用

- `packages/app/src/features/content-browser/Header.tsx:62` — `text-agent-success` → `text-success`（新桥接后可用）
- 全仓检索 `agent-creator` / `agent-success` 等未定义引用，按需替换或删除

#### 1.4 Dark mode 值迁移

`styles.css:37-67` 的 `@media (prefers-color-scheme: dark)` 块内所有变量同步改名（`--sp-background: #171717` 等），并补齐新增 token 的 dark 值：

- `--sp-success` / `--sp-success-foreground`（dark 适配）
- `--sp-warning` / `--sp-warning-foreground`（dark 适配）

Dark mode 仍由 OS `prefers-color-scheme` 驱动（`@custom-variant dark` 声明保留但业务组件继续不写 `dark:` 修饰符）。

---

### 2. 废弃 `scopeCss`，改用原生 CSS Nesting

**这是本次最大幅度的简化**，用标准 CSS nesting 替代自写的 `scope-css.ts`。

#### 2.1 为什么可以废弃

Electron 渲染进程跑在现代 Chromium 上，CSS nesting（`a { b { } }` 语法）自 Chrome 112（2023）起原生支持，Spherse 的目标运行时远高于这个版本。`scopeCss` 的全部职责（给用户 CSS 每个选择器加 scope 前缀、处理裸声明、passthrough at-rule）都可以用「在用户 CSS 外面包一层 `[data-chat-root] { ... }`」原生实现，且自动正确处理 `@media` / `@keyframes` / 嵌套等各种情况。

#### 2.2 新的聊天主题写法

用户直接写**原生 CSS nesting**，最外层是 `[data-chat-root]`：

```css
[data-chat-root] {
  /* 根级变量、背景 */
  --sp-background: #0c0b12;
  --sp-foreground: #e8e6f0;
  background-image: url('...');

  /* 嵌套选择器——自动作用域到 chat 内 */
  [data-chat-header] { border-bottom: 1px solid #2a2932; }
  [data-chat-bubble] { border-radius: 12px; }
  [data-chat-message][data-role="assistant"]::before {
    /* avatar via pseudo-element */
    content: '';
  }

  /* dark mode——嵌套 @media 原生工作，无需任何解析 */
  @media (prefers-color-scheme: dark) {
    --sp-background: #000;
    [data-chat-header] { background: #000; }
  }
}
```

不需要任何转换。`<style>` 标签直接注入原始 CSS 文本。

#### 2.3 一次性消除的问题

| `scopeCss` 时代的问题 | nesting 后 |
|----------------------|-----------|
| 不能写 `[data-chat-root] {…}`（会被二次前缀） | 就是这么写，天然正确 |
| 裸声明必须单行 | 无限制，正常写 |
| 多行裸声明被误处理 | 不存在 |
| `@media` 内选择器不加前缀（dark mode 失效） | 嵌套 `@media` 自动作用域 |
| floating chat 需要另一套 scope（`scopeCss(css, "[data-chat-float-root]")`） | **同一份 CSS 同时覆盖 inline + floating**：`[data-chat-root]` 块作用于两者（floating 的 `data-chat-root` 嵌套在 `data-chat-float-root` 内）；若需单独定制浮动窗 chrome，再加一个 `[data-chat-float-root] { ... }` 顶层块 |

#### 2.4 统一的三级层叠模型

废弃 `scopeCss` 后，project theme 与 agent theme 用**完全相同的语法**（`[data-chat-root] { ... }` nesting），形成清晰的三级层叠（低 → 高优先级）：

1. **App defaults**（`styles.css`）— 内置 `:root` / `--sp-*` 变量
2. **Project theme**（`.spherse/theme.css`，全局 `<link>` in `document.head`）— 可写 `[data-chat-root] { ... }` 块，作用于**所有** chat 窗口 = 全局 chat 默认样式
3. **Agent theme**（`.spherse/agents/*/theme.css`，后注入的 `<style>` in chat body）— 相同特异性下覆盖 project theme = 单 agent 覆盖

**优先级原理**：project theme 是 `document.head` 的 `<link>`，agent theme 是 chat 容器内后加载的 `<style>`。CSS 层叠规则下，相同特异性的规则后者胜出，因此 agent theme 自然覆盖 project theme 的 chat 规则。

这意味着 `.spherse/theme.css` 现在可以同时承担两个角色——全局 UI 变量（`--sp-*` in `:root`）+ 全局 chat 默认样式（`[data-chat-root] { ... }`）。以前 `scopeCss` 时代这个能力其实也存在（project theme 本就是全局 CSS），但 skill 文档从未示范 chat 选择器写法。nesting 让两种主题文件语法统一，这个能力应在 skill 文档里明确示范（见第 6 节）。

#### 2.4 代码变更

- **删除** `packages/app/src/lib/scope-css.ts` 及其单测
- **`useAgentTheme.ts`**：去掉 `scopeCss(css, "[data-chat-root]")` 调用，直接 `setCss(css)`（或保持返回值命名 `themeCss` 更准确）；hook 签名增加 `projectId`（见第 4 节 reload）
- **`FloatingChatContainer.tsx`**：去掉 `scopeCss(css, "[data-chat-float-root]")`，直接注入原始 CSS
- **`Chat`（`index.tsx:37-38`）**：`<style>{themeCss}</style>` 注入原始 CSS

> 作用域隔离由用户 CSS 的 `[data-chat-root] { ... }` 包裹保证。浮窗 chrome 定制通过独立的 `[data-chat-float-root] { ... }` 顶层块。两块在同一份 `theme.css` 内。

---

### 3. data-* 钩子补齐

**原则**：现有 `data-chat-*` 名字全部保留，`data-role` 语义不变。只补缺失的钩子、去除脆弱的位置选择器。

#### 3.1 新增 chat 钩子

| 元素 | 新 data 属性 | 替换的脆弱选择器 | 涉及文件 |
|------|-------------|----------------|---------|
| 消息气泡（内容容器） | `data-chat-bubble` | `> div:first-child` | `MessageItem.tsx:26`（内层 div 加属性） |
| 输入框外框 | `data-chat-composer-input` | `[data-chat-composer] > div` | `Composer.tsx:86` |
| 浮动窗关闭按钮 | `data-chat-float-close` | `[data-chat-float-titlebar] button` | `FloatingChatFrame.tsx`（close button） |

#### 3.2 Markdown 块钩子（共享 chat + document）

给 `MarkdownContent.tsx` 的 `CHAT_COMPONENTS` **与** `DOCUMENT_COMPONENTS` 都加上同一组 `data-md-*` 属性。作用域由**父选择器**表达，而不是变体专属前缀：

| Markdown 元素 | data 属性 |
|--------------|----------|
| 代码块（`<pre>`） | `data-md-code` |
| 行内代码（`<code>`） | `data-md-code-inline` |
| 引用（`<blockquote>`） | `data-md-quote` |

> 注意：`code` 元素在 `pre` 内与行内两种场景都会出现。`data-md-code` 打在 `pre` 上（外层块），`data-md-code-inline` 打在行内 `code` 上，避免歧义。`pre` 内部的 `code` 不加 `data-md-code-inline`（它由外层 `pre` 的 `data-md-code` 代表）。

两个组件映射用同一组属性，是因为 `data-md-*` 本身不带作用域——作用域由主题作者用父选择器显式表达：

```css
/* 项目级 .spherse/theme.css —— 默认 markdown 样式（同时作用于文档视图和聊天） */
[data-md-code] { background: #1e1e1e; }

/* 项目级 theme.css —— 只定制文档视图的 markdown（限定到文档容器） */
[data-content-doc] [data-md-code] { border-radius: 8px; }

/* agent theme.css —— 只定制聊天的 markdown（通过 nesting 限定到 chat） */
[data-chat-root] {
  [data-md-code] { background: #0c0b12; }
}
```

#### 3.3 文档视图容器钩子

`packages/app/src/features/content-browser/ContentView.tsx:81` 的文档渲染容器加 `data-content-doc`，作为项目级主题定制文档视图的锚点：

```tsx
<div data-content-doc className="rounded-lg border border-border bg-card p-6 ...">
  <MarkdownContent variant="document">{content}</MarkdownContent>
</div>
```

这样项目级 `.spherse/theme.css` 可以通过 `[data-content-doc]` 精准定制文档视图，而不影响聊天窗口。

#### 3.4 现有钩子（保持不变）

| 元素 | 属性 |
|------|------|
| Chat 容器 | `data-chat-root` |
| Header | `data-chat-header` |
| 消息列表 | `data-chat-messages` |
| 单条消息外层 | `data-chat-message` + `data-role="user"`/`"assistant"` |
| Composer 外层 | `data-chat-composer` |
| 浮动窗根 | `data-chat-float-root` |
| 浮动窗标题栏 | `data-chat-float-titlebar` |

---

### 4. Chat Dark Mode

**本节随第 2 节（废弃 `scopeCss`）一并解决，无需单独方案。**

原生 CSS nesting 下，用户在 `[data-chat-root] { ... }` 内嵌套 `@media (prefers-color-scheme: dark) { ... }`，浏览器原生处理嵌套 at-rule，dark mode 自动跟随 OS 切换，且作用域天然限定在 chat 内，不会污染全局。

需要做的只是**文档与模板更新**（见第 6 节）：在模板中示范 light/dark 双调色板写法，在 skill 文档中新增「暗色适配」章节。

---

### 5. Chat Theme 自动重载

**Server 端已完成**：`packages/server/src/lib/fs-watcher.ts:5-11` 的 `WATCHED_CATEGORIES` 已包含 `agentTheme`，`.spherse/agents/*/theme.css` 变更会通过 WebSocket bus 推送 fs-watch 事件。本节只描述 renderer 端订阅。

#### 5.1 `useAgentTheme` 改造

当前 `packages/app/src/features/chat/hooks/useAgentTheme.ts` 仅在 `[client, agentId]` 变化时 fetch 一次，不订阅 fs-watch。

改造：

1. hook 签名增加 `projectId` 参数（从调用方传入，保持 hook 纯净）
2. 增加 `useBusSubscription(projectId, "fs-watch", handler)`（复用 `useCustomTheme.ts:23` 的模式）
3. handler 内：规范化 path（`replace(/\\/g, "/")`），用宽松匹配 `path.includes("agents/") && path.endsWith("theme.css")` 过滤；命中后 debounce ~250ms（避免编辑过程中高频触发），重新 fetch（**直接取原始 CSS，不再 rescope**——见第 2 节）
4. fetch 复用现有 `client.getAgentTheme` 逻辑（抽成内部函数避免重复）

**路径匹配策略选择**：宽松匹配而非精确 slug+shortId 匹配。理由：
- GET 请求开销极小（返回纯文本 CSS）
- 一个 chat/floating 窗口只关心自己的 agent theme，误匹配最多导致多 refetch 一次，无副作用
- 精确匹配需要把 agent 的 slug+shortId 传进 hook，引入额外耦合

#### 5.2 Floating chat 同步

`packages/app/src/features/floating-chat/FloatingChatContainer.tsx:27-38` 已有自己的 fetch 逻辑（第 2 节已去掉 scope）。同样加 `useBusSubscription` + debounce refetch，匹配条件相同。与 `useAgentTheme` 共用同一个匹配辅助函数，避免逻辑分叉。

#### 5.3 调用方传参

`Chat`（`packages/app/src/features/chat/index.tsx`）与 `FloatingChatContainer` 调用 `useAgentTheme` / 内部 fetch 时，从 `useProjectCtx()` 或现有 props 取 `projectId` 传入。

---

### 6. 文档与 skill 同步

#### 6.1 官方文档

- **`docs/official/architecture.md:85-99`**（前端样式章节）：
  - 更新 token 命名说明（`--sp-*` 自有命名空间，替代 `--shadcn-*`）
  - 更新 Spherse 业务 token 说明（`--sp-{name}` + `--color-{name}` Tailwind 映射，替换原 `--agent-{name}` 说法）
  - 说明 agent 主题改用原生 CSS nesting（废弃 `scopeCss`），用户在 `[data-chat-root] { ... }` 内写嵌套 CSS
  - 说明三级层叠模型（app defaults → project theme → agent theme，见 2.4）
  - data-* 钩子清单补齐新增项（含文档视图 `data-content-doc` 与 `data-md-*`）
  - 补充 chat dark mode 跟随 OS 切换的说明（嵌套 `@media` 原生工作）
  - 补充 chat theme 自动重载的说明（fs-watch 已覆盖 `agentTheme`）
  - 移除对 `scope-css.ts` 的引用（`project-structure.md:166`）
- **`AGENTS.md`**（前端样式规范段）：把示例中的 `bg-agent-creator` / `text-agent-success` 改为 `bg-{name}` / `text-success` 等正确 token 引用，并更新 token 命名规范说明（`--sp-*`）
- **`docs/official/data-conventions.md`**：token 相关描述如有引用 `--shadcn-*` / `--agent-*` 的同步更新
- **`docs/official/project-structure.md`**：移除 `scope-css.ts` 条目（如已删除）

#### 6.2 Presets skill 文档与模板

- **`packages/presets/skills/create-ui-theme/SKILL.md`**：
  - 全部变量名从 `--shadcn-*` → `--sp-*`
  - 补齐新增 token（success/warning 等）
  - 新增「全局 chat 默认样式」章节：示范在 `.spherse/theme.css` 里写 `[data-chat-root] { ... }` nesting 块，作用于所有 agent 的 chat 窗口（作为单 agent 主题覆盖之前的全局默认）
  - 新增「文档视图 markdown 样式」示例（`[data-content-doc] [data-md-code]` 等）
  - 修正示例中的默认值表格
- **`packages/presets/skills/create-agent-chat-theme/SKILL.md`**：
  - **重写核心章节**：从「scopeCss 会自动加前缀，不要写 `[data-chat-root]`」改为「用原生 CSS nesting，最外层写 `[data-chat-root] { ... }`」
  - 说明层叠关系：agent theme 覆盖 project theme 的 chat 默认样式（见 2.4 三级层叠模型）
  - 变量名从 `--shadcn-*` → `--sp-*`
  - 选择器示例用新增 `data-chat-bubble` / `data-chat-composer-input` / `data-chat-float-close` / `data-md-*` 替换脆弱位置选择器
  - 新增「暗色适配」章节（嵌套 `@media`）
  - 移除所有「Scope Gotchas」相关说明（nesting 下不存在）
- **`packages/presets/templates/agent-theme-template.css`**：
  - **整体重写为 nesting 结构**：最外层 `[data-chat-root] { ... }`，内部嵌套各选择器
  - 变量名 `--shadcn-*` → `--sp-*`
  - 用新 data-* 钩子重写示例
  - 加 light/dark 双调色板示例（嵌套 `@media`）
- 改完后跑 `npm run build --workspace=packages/presets` 触发同步脚本（`sync-templates.mjs`）

#### 6.3 Backlog

- `docs/dev/backlog.md:56`（`[ ] 内置 Skill：主题制作 Skill`）：现有 `create-ui-theme` / `create-agent-chat-theme` skill 已存在并本次进一步增强，标记为 `[x]` 并说明本次更新内容
- 新增本次 feature 的 backlog 条目指向本 design doc

---

## 涉及文件总览

### 新增文件

无。

### 删除文件

| 文件 | 说明 |
|------|------|
| `packages/app/src/lib/scope-css.ts` | 废弃，改用原生 CSS nesting |
| 对应单测文件（如 `scope-css.test.ts`） | 随之删除 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/app/src/styles.css` | `--shadcn-*`/`--agent-*` → `--sp-*`，新增 success/warning token 及 dark 值 |
| `packages/app/src/features/chat/hooks/useAgentTheme.ts` | 去掉 `scopeCss` 调用（返回原始 CSS）+ 增加 `projectId` 参数 + fs-watch 订阅 + debounce refetch |
| `packages/app/src/features/floating-chat/FloatingChatContainer.tsx` | 去掉 `scopeCss` 调用 + 增加 fs-watch 订阅 + debounce refetch |
| `packages/app/src/features/chat/index.tsx` | 注入原始 CSS + 调用 `useAgentTheme` 传入 `projectId` |
| `packages/app/src/features/chat/MessageItem.tsx` | 内层气泡 div 加 `data-chat-bubble` |
| `packages/app/src/features/chat/Composer.tsx` | 输入框外框 div 加 `data-chat-composer-input` |
| `packages/app/src/components/MarkdownContent.tsx` | `CHAT_COMPONENTS` 与 `DOCUMENT_COMPONENTS` 的 pre/code/blockquote 加 `data-md-*` |
| `packages/app/src/features/floating-chat/FloatingChatFrame.tsx` | close button 加 `data-chat-float-close` |
| `packages/app/src/features/content-browser/ContentView.tsx` | 文档容器加 `data-content-doc` |
| `packages/app/src/features/content-browser/Header.tsx` | `text-agent-success` → `text-success` |
| 其他引用 `agent-*` token 的组件 | 全仓检索并替换为 `--sp-*` / 新 Tailwind 类 |
| `packages/presets/skills/create-ui-theme/SKILL.md` | 变量名 → `--sp-*` + 文档视图 markdown 示例 |
| `packages/presets/skills/create-agent-chat-theme/SKILL.md` | 重写为 nesting 写法 + 变量名 + 新钩子 + dark mode 章节 |
| `packages/presets/templates/agent-theme-template.css` | 重写为 nesting 结构 + 变量名 + 新钩子 + light/dark 示例 |
| `docs/official/architecture.md` | token / nesting / dark mode / data-* / reload 说明同步 |
| `docs/official/project-structure.md` | 移除 `scope-css.ts` 引用 |
| `docs/official/data-conventions.md` | token 引用同步（如有） |
| `AGENTS.md` | 前端样式规范段 token 示例与命名规范说明 |
| `docs/dev/backlog.md` | 标记主题 skill 条目完成 + 新增本次 feature 条目 |

### 不改动

- 所有组件的 Tailwind 类名（`bg-background` 等）—— 通过 `@theme inline` 桥接解耦
- 现有 `data-chat-*` 钩子名字、`data-role` 语义
- fs-watcher server 端白名单（已含 `agentTheme`）
- WebSocket bus 管道（已验证可用）
- 项目级主题的加载管道（`useCustomTheme` `<link>` 注入，已支持 hot-reload）

## 验证

- `npm run lint` + `npm run build` 通过
- 手动验证：
  - 编辑 `.spherse/agents/*/theme.css`，chat/floating 窗口自动重载
  - 写嵌套 `@media (prefers-color-scheme: dark)` 的 chat theme，切换 OS 外观后聊天窗口暗色样式正确应用且不污染全局
  - 项目级 `.spherse/theme.css` 写 `[data-content-doc] [data-md-code] { ... }`，文档视图 markdown 样式生效
  - agent theme 写 `[data-chat-root] { [data-md-code] { ... } }`，聊天 markdown 样式生效
- 确认幽灵 token 引用（`text-agent-success`、`bg-agent-creator`）已全部消除
- 确认 `scope-css.ts` 及其测试已删除，无残留 import
- E2E：按需跑受影响的 spec（chat/session、content-browser 相关）
