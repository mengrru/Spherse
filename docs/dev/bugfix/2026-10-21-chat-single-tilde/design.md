# 修复聊天中单波浪线误解析为删除线

- 日期：2026-10-21
- 状态：已实施（测试与 lint 通过）
- 类型：bugfix（渲染行为）
- 影响范围：`packages/app`（`MarkdownContent` chat variant 渲染配置）
- 来源：#153（10-18 评论）、#64（8-31 评论）

## 1. 问题

chat 的 assistant 气泡中，成对的单波浪线被 remark-gfm 的 GFM strikethrough 扩展解析为 `<del>` 删除线：`内容A~内容B，内容C~内容D` 显示为「内容A~~内容B，内容C~~内容D（删除线）」。波浪线无词边界要求（不同于下划线 emphasis），CJK 文本里偶然出现的成对 `~` 极易误伤，影响阅读体验。

## 2. 根因

`MarkdownContent.tsx` 对所有非 plain 模式统一使用 `[remarkGfm]`。remark-gfm 默认 `singleTilde: true`，允许单个 `~` 开闭删除线（`micromark-extension-gfm-strikethrough` 行为）。

## 3. 需求收敛（与用户确认的方案）

- 聊天 assistant Markdown：单 `~` 保留字面；显式 `~~` 仍支持删除线
- 用户气泡（plain 模式）：现有 plain 语义保持，不改动（`del` 退化纯文本是 2026-08-23 设计的预期行为；不为保留 `~~` 重新开启 Markdown）
- 文档预览（`variant="document"`）：保持既有 GFM 行为不变（`~x~` 仍是删除线）
- 聊天作用域内，流式渲染与历史重载共用同一渲染路径，行为一致

## 4. 方案

`MarkdownContent.tsx` 将 remark 插件列表提升为模块级常量并按模式分派：

```tsx
const PLAIN_REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm, remarkPlainStructure, remarkBreaks];
const CHAT_REMARK_PLUGINS: Options["remarkPlugins"] = [[remarkGfm, { singleTilde: false }]];
const DOCUMENT_REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm];
```

- `singleTilde: false` 是 remark-gfm 官方支持的解析选项（透传 micromark-extension-gfm），在解析层关闭单 `~` 开闭，`~~` 双波浪线不受影响。不做任何全文正则替换，代码 span / 围栏代码 / 转义（`\~`）/ 链接目的地天然不受影响——strikethrough 是 inline token 级解析，这些上下文在 tokenize 阶段已隔离
- 纯解析选项，不参与 react-markdown 的序列化路径

选择插件配置而非文本预处理：零自研解析逻辑，边界行为（转义、代码、链接、嵌套）由上游解析器保证。

## 5. 不受影响的部分

- 用户气泡 plain 模式：插件列表、allowlist、`remark-breaks` 均未改动
- 文档预览 / Content Browser（`variant="document"`）：仍为完整默认 GFM
- UpdateChecker release notes（`variant="chat"` 非 plain）：随 chat variant 一起关闭单波浪线，属聊天作用域内一致行为；release notes 无单 `~` 删除线诉求
- landing 文档站（独立 react-markdown 实例）：不在本次范围

## 6. 测试

新增 `packages/app/src/components/markdown-content/MarkdownContent.tilde.test.tsx`：

1. chat variant：成对单 `~` 字面保留（#64/#153 原始复现文本）、不成对 `~`、`~~` 仍渲染 `<del>`、`\~` 转义、行内代码、围栏代码、链接目的地含 `~`、单双混合互不干扰
2. document variant：单 `~` 与 `~~` 均仍渲染 `<del>`（回归锚点）
3. plain 模式：`~~` 退化纯文本、单 `~` 对维持现有退化行为（锁定「plain 语义保持」）、词内下划线字面（用户气泡保真回归）

`AssistantBubble.test.tsx` 补集成断言：单 `~` 文本在 streaming 与非 streaming（历史重载共用路径）两种状态下均字面渲染；`~~` 仍为删除线。
