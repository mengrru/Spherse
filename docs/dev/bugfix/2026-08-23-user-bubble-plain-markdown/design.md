# 修复 user bubble 换行丢失，并将用户消息降级为 plain markdown 渲染

- 日期：2026-08-23
- 状态：已实施（测试与 lint 通过）
- 类型：bugfix（渲染行为）+ 行为收敛
- 影响范围：`packages/app`（`MarkdownContent`、chat/floating chat 共用的 `MessageItem`）

## 1. 问题

chat 的 user bubble 中，用户输入的单个换行 `\n` 被渲染成一个空格，需要两个换行 `\n\n` 才能真正换行。用户在输入框里敲的换行与气泡里看到的排版不一致。

## 2. 根因分析

`packages/app/src/features/chat/MessageItem.tsx:75` 传入了 `breaks={isUser}`，意图让 user 消息的单换行渲染为 `<br>`：

```tsx
<MarkdownContent variant="chat" breaks={isUser} ...>
```

但本项目使用的 react-markdown 是 **v10.1.0**，该版本（以及 v5+ 全系）**不存在 `breaks` option**——它是 v4 时代的老 API，v5 起被移除。react-markdown 对未知 option 静默忽略，于是单换行按 CommonMark 默认规则合并为空格。这与上一条链接颜色 bug（2026-08-15）同模式：prop 看似生效实则无效，根因是 API 版本错位。

v10 下让单换行生效的标准做法是启用 `remark-breaks` 插件（将 `\n` 转为 `<br>`），当前项目未安装。

## 3. 需求收敛（与用户确认的方案）

在修换行的同时，把 user bubble 的 markdown 能力收敛为 plain 模式：

- **保留**：blockquote（引用）、code block（`pre`/`code`）、链接（`a`）
- **禁用**：heading、list、table、image、hr、emphasis/strong/strikethrough 等一切其它块级/行内语法——对应标记退化为纯文本（内容保留，如 `**x**` 渲染为 `x`）

理由：用户消息本质是「我打进来的话」，不是文档；绝大多数用户不会在聊天输入框里写 markdown 标题/列表，但他们的换行必须所见即所得。禁用多余语法还能避免用户消息中的 `#`、`-`、`|` 等字符被意外解释成排版结构。

assistant 消息与 document 视图维持现状（完整 GFM 渲染）不动。

## 4. 方案

### 4.1 单换行：`remark-breaks` 插件

- `packages/app` 新增依赖 `remark-breaks`
- `MarkdownContent` 仅在 plain 模式下启用该插件（assistant 流式输出的 markdown 按标准 CommonMark 渲染，不受影响）

### 4.2 语法白名单：`allowedElements` + `unwrapDisallowed`

`MarkdownContent` 删除无效的 `breaks?: boolean` prop（已确认全仓库仅 `MessageItem.tsx:75` 一处消费），新增 `plain?: boolean`。plain 模式下向 react-markdown 传：

```tsx
allowedElements: ["p", "br", "blockquote", "pre", "code", "a"]
unwrapDisallowed: true
```

- `allowedElements`：不在白名单内的元素直接跳过渲染
- `unwrapDisallowed: true`：被跳过的元素**保留其子内容**——`**x**` 的 `strong` 被剥掉但文字 `x` 保留，不会丢内容
- 语义元素（如 `del`/`em`）的纯文本化是预期行为

选择 react-markdown 原生 allowlist 而不是自定义 remark 插件过滤 mdast：零额外代码、类型安全、且在 hast 层过滤天然覆盖 GFM 与基础语法两套来源。

### 4.3 调用方变更

`MessageItem.tsx`：`breaks={isUser}` → `plain={isUser}`。

## 5. 不受影响的部分

- assistant 气泡（完整 markdown，含流式渲染）
- Content Browser 文档视图（`variant="document"`）
- Settings 更新弹窗 release notes（`variant="chat"`，无 `plain`）
- 上一条 bugfix 的 `linkClassName="text-inherit"` 行为不变（plain 模式下 `a` 仍走既有 override，链接可点击、颜色正确）

## 6. 测试

更新 `packages/app/src/components/MarkdownContent.structure.test.ts`，plain 模式覆盖：

1. 单换行渲染出 `<br>`（依赖 remark-breaks）
2. `# 标题` / `- 列表` / `**bold**` 退化为纯文本（无 `h1`/`ul`/`strong` 节点，文字保留）
3. blockquote、code block、`[text](url)` 与裸 URL 正常渲染
4. 非 plain 模式回归：完整 GFM 渲染不受影响（现有用例应全绿）
