# Chat 体验细节打磨：approval toast、用户气泡换行、Composer 字号

三项独立的 chat 体验增强 / 修复。

## 1. Approval toast 优化

`ApprovalNoticeBridge`（`features/chat/ApprovalNoticeBridge.tsx`）在后台会话的工具调用停在 approval gate、且用户当前未停留在该会话时弹 sonner toast。当前问题：

- toast 的 `description` 直接展示将执行的命令原文（`item.command ?? item.toolName`），信息冗余且可能泄露长命令；用户跳转后内联 `CommandCard`/`ApprovalCard` 已展示完整内容。
- 标题是泛化的「一个 Agent 正在等待你的确认」，多个 agent 时无法区分。
- toast 的 action 按钮使用 sonner 内置样式（基于 sonner 自有 `--normal-text`/`--normal-bg`），不跟随应用主题（`--primary`），与其它按钮视觉不一致。

### 方案

**1a. 移除命令内容**：删除 `toast.success()` 的 `description` 字段，toast 仅保留标题 + action 按钮。

**1b. 标题注入 agent 名**：`agentId` 不在 `StreamingSession` 上，但可通过 `useProjectDataStore.getState()` 按 `projectId → sessions.find(id===sessionId).agentId → agents.find(id===agentId).name` 解析（与 `ChatPage.tsx`、`FloatingChatManager.tsx` 同一模式）。该 store 为普通 Zustand store，app 级 bridge 可直接 `.getState()` 读取（`streaming-store.ts` 已有同款用法）。

- 新增 i18n key `chat.approvalToastMessageWithName`，带 `{name}` 占位符，沿用 `「{name}」` 包裹约定（同 `agent-session-list.confirmDeleteAgent`）。
- 保留 `chat.approvalToastMessage`（泛化文案）作为无法解析 agent 名时的 fallback（项目未加载等边界）。
- bridge：`agentName ? t("...WithName", { name }) : t("chat.approvalToastMessage")`。

**1c. Toast 跟随主题（背景/文字/边框/按钮/描述）**：sonner 的 toast 既不跟随应用主题背景，其 action 按钮也不像 `<Button>` 那样跟随主题，根因相同——

sonner 在运行时通过 JS 往 `<head>` 末尾**注入无层（unlayered）CSS**。CSS Cascade Layers 规则下，**无层样式优先于任何 `@layer` 内的样式**，与特异性无关。因此 `<Toaster>` 上那组 Tailwind 工具类（`group-[.toaster]:bg-background` 等，编译进 Tailwind 的 utilities 层）**永远输给** sonner 注入的无层规则：

- sonner `[data-sonner-toast][data-styled='true'] { background: var(--normal-bg) }`（无层，`(0,2,0)`）把 `--normal-bg` 解析为 sonner 自有的 `#fff`/`#000` 调色板（且 `<Toaster>` 未传 `theme`，恒为 light → 恒为 `#fff`），而非应用 `--background`。`group-[.toaster]:bg-background`（`(0,2,0)`、有层）即便特异性持平也因有层而落败。
- sonner `[data-sonner-toast][data-styled='true'] [data-button] { background: var(--normal-text) }`（无层，`(0,3,0)`）同理压制任何有层工具类。`group-[.toast]:bg-primary`（`(0,2,0)`、有层）落败。

> 关键结论：**Tailwind 工具类（有层）无法可靠覆盖 sonner 注入的无层 CSS**——即便加 `!important` 也只在按钮等非主题化元素上可接受，给 toast 主体加 `!important` 会压过用户 `theme.css` 中非 important 的同类规则，破坏 `[data-toast-root] [data-sonner-toast]` 主题契约（示例项目 harry-potter 正是用该选择器定制 toast border）。

### 方案（全部在 `styles.css`，无层规则）

集中用**无层 + 高特异性**规则在 `styles.css` 覆盖，既能在特异性上压过 sonner 同为无层的默认值、又保留 `theme.css` 的可覆盖性，`sonner.tsx` 维持 shadcn 原样：

```css
/* 重定向 sonner 调色板变量到应用主题 token：(0,3,0) 压过 sonner 的 (0,2,0) per-theme 定义 */
[data-toast-root] [data-sonner-toaster][data-sonner-theme] {
  --normal-bg: var(--sp-background);
  --normal-text: var(--sp-foreground);
  --normal-border: var(--sp-border);
}
/* 描述用 muted-foreground（替代 sonner 硬编码的 #3f3f3f，暗色下对比度不足）：(0,4,0) 压过 (0,3,0) */
[data-toast-root] [data-sonner-toast][data-styled='true'] [data-description] {
  color: var(--sp-muted-foreground);
}
/* action 按钮读作默认 <Button>（bg-primary）：(0,4,0) 压过 sonner [data-button] 的 (0,3,0) */
[data-toast-root] [data-sonner-toast] [data-button][data-action] {
  background: var(--sp-primary);
  color: var(--sp-primary-foreground);
}
[data-toast-root] [data-sonner-toast] [data-button][data-action]:hover {
  background: color-mix(in oklab, var(--sp-primary) 80%, transparent);
}
```

变量重定向让 sonner 自身机制产出主题色（背景/文字/边框/关闭按钮一并跟随），无需对主体加 `!important`；按钮因要呈现 `bg-primary`（而非 `--normal-text` 解析出的前景色）单独显式声明。Lightning CSS 自动为 `color-mix` 生成 `@supports` 回退。无新增 DOM 钩子，`create-ui-theme` skill 文档无需更新。

## 2. 用户气泡单换行渲染

`MarkdownContent`（`components/MarkdownContent.tsx`）用 react-markdown（`remarkGfm` + `rehypeSlug`）渲染，**未启用 `breaks`**。CommonMark 默认把单个 `\n` 当软换行折叠为空格，导致用户在 Composer 用 Shift+Enter 输入的多行文本被合并成一行。

输入管线本身正确保留了 `\n`（`Composer.tsx` 的 textarea、`trim()`、localStorage draft），问题仅在渲染层。

### 方案

react-markdown v10 原生支持 `breaks` prop（映射到 micromark `breaks: true`，单个 `\n` → `<br>`），**无需新增依赖**。

- 给 `MarkdownContent` 增加可选 `breaks?: boolean` prop，传给 `<Markdown breaks={breaks}>`。默认 falsy → document variant 与 assistant 气泡渲染行为不变。
- `MessageItem.tsx:73` 传 `breaks={isUser}`：仅用户气泡单换行渲染为换行；assistant LLM markdown 保持严格 CommonMark（LLM 用 `\n\n` 分段，单 `\n` 多为软折行）。

## 3. Composer 字号修复（tailwind-merge responsive 陷阱）

PR `620ac0f` 把 `Composer.tsx:147` 的 `text-sm` 改为 `text-base`，但桌面端字号「没有变化」。

### 根因

shadcn `Textarea`（`components/ui/textarea.tsx:10`）基类含 `md:text-xs/relaxed`。`cn()` 用 `twMerge`，冲突解析按 variant 分组进行：

- 非响应式 font-size 组：基类 `text-sm` 与传入 `text-base` 冲突 → `text-base` 胜（后传）。
- `md:` font-size 组：`md:text-xs/relaxed` 无对手 → 保留。

CSS 级联：`.text-base{font-size:1rem}`（16px）在 ≥768px 被 media query 规则 `.md\:text-xs\/relaxed{font-size:0.75rem}`（12px）覆盖（响应式规则生成在后）。故桌面端实际 12px，比改动前的 `text-sm`（14px，同样被 `md:text-xs/relaxed` 压过）还小——改动只在 <768px 生效，桌面端「没有变化」。

`styles.css` 无 textarea 规则，无其它竞争样式。

### 方案

在 `Composer.tsx:147` 用与基类 `md:text-xs/relaxed` 同属 `md:` 组的 `md:text-sm` 在该组内取胜（后传），全断点 14px。同时恢复 `leading-5`（20px）与 `LINE_HEIGHT=20` 一致，保持 auto-resize 测高正确。

> 最初按 PR `620ac0f` 的意图补的 `md:text-base`（16px）实测偏大，故下调一档回 `text-sm`（14px）。与 PR 前的区别在于多了 `md:text-sm`——正是这一条让 14px 在桌面端真正生效（此前被基类 `md:text-xs/relaxed` 压成 12px，所以 PR 作者误以为要再加大字号）。

仅局部改动 Composer，不动基类 `Textarea`（`md:text-xs/relaxed` 是全应用 dense-text 默认，`input.tsx` 同款）。

## 验证

- `npm run verify`（lint + build + unit + i18n check —— i18n 校验要求三语种 key 齐全）。
- `sonner.structure.test.ts`（确认 `data-toast-root` 钩子完好）。
- `MarkdownContent` 若有测试则补 `breaks` 断言。
- 桌面端运行确认：toast 标题含 agent 名 + 背景跟随主题；用户气泡单换行渲染；Composer 字号 14px。

## 涉及文件

- `packages/app/src/features/chat/ApprovalNoticeBridge.tsx`
- `packages/app/src/styles.css`（toast 主题化覆盖规则）
- `packages/app/src/components/MarkdownContent.tsx`
- `packages/app/src/features/chat/MessageItem.tsx`
- `packages/app/src/features/chat/Composer.tsx`
- `packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts`
