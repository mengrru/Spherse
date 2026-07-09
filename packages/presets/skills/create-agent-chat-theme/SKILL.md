---
name: create-agent-chat-theme
description: Use when creating or editing an agent-level Spherse chat window theme.css for custom chat backgrounds, headers, message bubbles, avatars, composer inputs, markdown blocks, or placeholder text.
---

# Agent Chat Theme

Agent chat themes live in the agent directory as `theme.css` (`.spherse/agents/{agent-slug}/theme.css`).

## 写法：原生 CSS Nesting

用**原生 CSS nesting** 编写，最外层包裹 `[data-chat-root] { ... }`，所有规则嵌套其中。Electron 渲染进程跑在现代 Chromium 上（Chrome 112+ 起原生支持 CSS nesting）。主题以 `<link rel="stylesheet">` 从项目 preview 路由载入（与项目级主题一致），**不做任何转换**。

```css
[data-chat-root] {
  /* 根级变量 */
  --sp-background: #0c0b12;

  /* 嵌套选择器——自动作用域到 chat 内 */
  [data-chat-header] { border-bottom: 1px solid #2a2932; }
  [data-chat-bubble] { border-radius: 12px; }
}
```

不要把根级变量 / 背景声明写在最外层之外。它们必须落在 `[data-chat-root] { ... }` 内，才能作用于聊天窗口。

## 层叠关系

聊天主题遵循三级层叠（低 → 高优先级）：

1. **App defaults**（`styles.css`）— 内置 `:root` / `--sp-*` 变量
2. **Project theme**（`.spherse/theme.css`，通过 `document.head` 的 `<link>` 注入）— 可覆盖 UI 变量，也可写 `[data-chat-root] { ... }` 块，作为**所有** chat 窗口的全局默认样式
3. **Agent theme**（本文件，chat 容器内后载入的 `<link>`）— 相同特异性下覆盖 project theme 的 chat 规则

优先级原理：agent theme 的 `<link>` 渲染在 chat 容器内，DOM 顺序上比 project theme 的 `<link>`（位于 `document.head`）更靠后。CSS 层叠规则下，相同特异性的规则后者胜出，因此 agent theme 自然覆盖 project theme 的 chat 规则。

> 想给所有 agent 设统一聊天默认样式，优先写进项目级 `.spherse/theme.css` 的 `[data-chat-root] { ... }` 块；单个 agent 覆盖默认值，写在本文件里。

## 选择器速查

| 目标 | 选择器 |
|------|--------|
| Chat 根级颜色变量 | 在 `[data-chat-root] { ... }` 内声明 `--sp-*` 变量 |
| Chat 根级渐变/图片背景 | 在 `[data-chat-root] { ... }` 内写 `background:` / `background-image:` |
| Header | `[data-chat-header]` |
| 消息外层行 | `[data-chat-message][data-role="user"]` 或 `[data-role="assistant"]` |
| 消息气泡 | `[data-chat-bubble]` |
| 助手头像 | `[data-chat-message][data-role="assistant"]::before` |
| Composer 外层 | `[data-chat-composer]` |
| 输入框外框 | `[data-chat-composer-input]` |
| 文本输入区文字 | `[data-chat-composer] textarea` |
| Placeholder | `[data-chat-composer] textarea::placeholder` |
| 代码块 | `[data-md-code]` |
| 行内代码 | `[data-md-code-inline]` |
| 引用块 | `[data-md-quote]` |

## 完整选择器参考

所有可用 `data-*` 钩子（嵌套在 `[data-chat-root] { ... }` 内使用）：

| 钩子 | 作用对象 |
|------|---------|
| `data-chat-root` | 聊天窗口根容器（最外层包裹） |
| `data-chat-header` | 顶部 header |
| `data-chat-messages` | 消息列表区 |
| `data-chat-message` + `data-role="user"`/`"assistant"` | 单条消息外层 |
| `data-chat-bubble` | 消息气泡（内容容器） |
| `data-chat-composer` | 输入区外层 |
| `data-chat-composer-input` | 输入框外框 |
| `data-chat-float-root` | 浮动窗根容器 |
| `data-chat-float-titlebar` | 浮动窗标题栏 |
| `data-chat-float-close` | 浮动窗关闭按钮 |
| `data-md-code` | 代码块（`<pre>`） |
| `data-md-code-inline` | 行内代码（`<code>`） |
| `data-md-quote` | 引用块（`<blockquote>`） |

> 以上钩子均在聊天窗口 DOM 内，可嵌套在 `[data-chat-root] { ... }` 中定制。
>
> 其它可主题化区域（项目面板 `data-project-panel`、内容浏览器 `data-content-browser`、文档视图容器 `data-content-doc`）在聊天窗口 DOM 之外，**不受 agent theme 影响**，请在项目级 `.spherse/theme.css` 中定制，详见 `create-ui-theme` skill。

## 引用图片与字体

主题以 `<link>` 从项目 preview 路由载入，CSS 中相对 `url()` 的解析基址为 agent 目录 `.spherse/agents/{agent-slug}/`。因此本地图片、字体等资源可以用相对路径正常引用。

- **素材放在 agent 目录**：推荐把图片/字体放进 agent 目录，用相对路径引用：
  ```css
  [data-chat-root] {
    background-image: url(./bg.png);
  }
  ```
- **引用项目内其它位置的文件**：用 `../` 跳出 agent 目录（`../` 到 `.spherse/`，再 `../` 到项目根）：
  ```css
  [data-chat-root] {
    background-image: url(../assets/welcome.png);   /* 项目根 assets/ 下 */
  }
  ```
- **远程 URL**：`url(https://example.com/texture.png)` 照常工作，不受影响。
- **字体**：`@font-face` 中的 `src: url(...)` 同样按上述规则解析。

> 不要使用从项目根开始的绝对路径（如 `url(/assets/x.png)`）——它不会解析到项目文件。始终用相对路径（`./`、`../`）或完整远程 URL。

## 示例

```css
[data-chat-root] {
  --sp-background: #0c0b12;
  --sp-foreground: #e2ddd4;
  --sp-primary: #c9a04a;
  --sp-primary-foreground: #0c0b12;
  --sp-card: rgba(18, 17, 28, 0.88);
  --sp-card-foreground: #e2ddd4;
  --sp-border: rgba(201, 160, 74, 0.12);
  --sp-muted-foreground: #7a7a8a;
  --sp-input: rgba(93, 169, 179, 0.2);
  --sp-ring: rgba(201, 160, 74, 0.4);

  /* 聊天窗口根级背景（渐变/图片直接写在根块内） */
  background: radial-gradient(ellipse at 20% 50%, rgba(201, 160, 74, 0.04) 0%, transparent 50%), linear-gradient(180deg, #0c0b12 0%, #11101a 50%, #0e0d16 100%);

  [data-chat-header] {
    color: #e2ddd4;
    background: rgba(12, 11, 18, 0.92);
    border-color: rgba(201, 160, 74, 0.12);
  }

  [data-chat-message][data-role="assistant"] {
    position: relative;
  }

  [data-chat-message][data-role="assistant"]::before {
    content: '';
    display: block;
    width: 36px;
    height: 36px;
    margin-right: 8px;
    flex-shrink: 0;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #e2c87a 0%, #c9a04a 40%, #8a6a2a 100%);
    box-shadow: 0 0 12px rgba(201, 160, 74, 0.3), inset 0 -2px 4px rgba(0, 0, 0, 0.3);
  }

  [data-chat-message][data-role="user"] [data-chat-bubble] {
    color: #0c0b12;
    background: linear-gradient(135deg, #c9a04a 0%, #b8893a 100%);
    border-radius: 18px 18px 4px 18px;
  }

  [data-chat-message][data-role="assistant"] [data-chat-bubble] {
    color: #e2ddd4;
    background: rgba(24, 23, 36, 0.9);
    border: 1px solid rgba(201, 160, 74, 0.08);
    border-radius: 18px 18px 18px 4px;
  }

  [data-chat-composer] {
    background: rgba(12, 11, 18, 0.92);
    border-top: 1px solid rgba(201, 160, 74, 0.08);
  }

  [data-chat-composer-input] {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(201, 160, 74, 0.08);
  }

  [data-chat-composer] textarea {
    color: #e2ddd4;
  }

  [data-chat-composer] textarea::placeholder {
    color: #7a7a8a;
  }

  [data-md-code] {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(93, 169, 179, 0.15);
    border-radius: 8px;
  }

  [data-md-quote] {
    border-left: 3px solid rgba(201, 160, 74, 0.4);
    background: rgba(201, 160, 74, 0.04);
    border-radius: 0 8px 8px 0;
    padding: 8px 16px;
  }
}
```

## 暗色适配

在 `[data-chat-root] { ... }` 内嵌套 `@media (prefers-color-scheme: dark) { ... }`，浏览器原生处理嵌套 at-rule，dark mode 自动跟随 OS 切换，且作用域天然限定在 chat 内，不污染全局。

```css
[data-chat-root] {
  /* light 值 */
  --sp-background: #f5f5f5;
  --sp-foreground: #171717;

  /* dark mode — 自动跟随 OS 偏好 */
  @media (prefers-color-scheme: dark) {
    --sp-background: #1a1a2e;
    --sp-foreground: #e8e8e8;
    [data-chat-bubble] { border-color: #333; }
  }
}
```

> 一份 `theme.css` 可以同时定义 light + dark 调色板，无需为暗色单独建文件。

## 浮动窗口（Floating Chat）

同一份 `theme.css` 同时覆盖 inline 与 floating chat：`[data-chat-root]` 块作用于两者（floating 模式下 `data-chat-root` 嵌套在 `data-chat-float-root` 内）。若需单独定制浮动窗的 chrome，在文件**顶层**再加一个 `[data-chat-float-root] { ... }` 块（不要嵌套在 `[data-chat-root]` 内）。

| 选择器 | 说明 |
|--------|------|
| `[data-chat-float-root]` | 浮动窗口容器。定制 border、border-radius、box-shadow、background、backdrop-filter |
| `[data-chat-float-titlebar]` | 标题栏。定制 background、text color、padding |
| `[data-chat-float-close]` | 关闭按钮。定制图标颜色、hover 态 |

示例：

```css
[data-chat-float-root] {
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(12px);
  background: rgba(30, 30, 40, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);

  [data-chat-float-titlebar] {
    background: rgba(0, 0, 0, 0.3);
    color: #e0e0e0;
  }

  [data-chat-float-close]:hover {
    background: rgba(255, 255, 255, 0.15);
  }
}
```

## 常见错误

- 把根级变量 / 背景声明写到 `[data-chat-root] { ... }` 之外——它们不会作用于聊天窗口。所有规则都要嵌套在根块内。
- 用位置选择器（如 `> div`、`> div:first-child`）选气泡或输入框——这些会随 DOM 结构变化失效。改用命名钩子 `[data-chat-bubble]` / `[data-chat-composer-input]`。
- 在 agent theme 里改侧边栏变量。Agent theme 只影响聊天窗口，不影响项目侧边栏；侧边栏变量应写在项目级 `.spherse/theme.css`。
- 重复定义同一 `::before` 头像规则。如非有意覆盖，每条规则只写一次。
