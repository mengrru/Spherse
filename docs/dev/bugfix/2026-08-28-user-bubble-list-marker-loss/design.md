# 修复 user bubble plain 模式丢失列表序号 / 表格结构与换行

- 日期：2026-08-28
- 状态：已实施（测试、lint、typecheck 通过）
- 类型：bugfix（渲染行为）
- 影响范围：`packages/app`（`MarkdownContent` 及其 plain 模式）

## 1. 问题

用户在输入框输入序号列表发送后，气泡里序号消失且两行合并为一段：

```
输入：          显示：
1. test1    →   test1 test2
2. test2
```

## 2. 根因分析

数据链路（Composer → store → WS → server → core 落盘）全程只 trim、无 markdown 转换，消息原文完整；问题纯在渲染层。2026-08-23 的 plain 模式实现（见 `docs/dev/bugfix/2026-08-23-user-bubble-plain-markdown/`）用 `allowedElements` + `unwrapDisallowed` 过滤：

- `remark-gfm` 把 `1. test1\n2. test2` 解析为 ordered list（tight list），mdast→hast 后序号数字**不是文本节点**——`<ol>` 的编号由浏览器列表渲染生成；
- `PLAIN_ALLOWED_ELEMENTS` 不含 `ol`/`ul`/`li`，`unwrapDisallowed` 剥掉标签只留子文本 → 序号随标签一起消失；
- tight list 的 item 之间是结构分隔、不产生 `<br>`，unwrap 后两段文本直接相连，HTML 折叠空白后显示为 `test1 test2`。

同理受害的还有（「顺便检查其它语法」的结论）：

| 语法 | 现象 | 严重度 |
|---|---|---|
| ordered list `1. x` | 序号丢失、行合并 | 严重（序号是数据） |
| unordered list `- x` | 行合并（bullet 本就是装饰，可丢） | 严重（行结构丢） |
| task list `- [ ] x` | checkbox 丢失 | 中 |
| GFM table | 全部单元格文本拼成一串 | 严重 |
| thematic break `---` | 整行消失 | 中 |
| emphasis `**x**`、heading `# x` | 标记退化为纯文本，内容保留 | 符合原设计，不动 |

设计文档的原意是「标记退化为纯文本、**内容保留**」，emphasis 类标记（`**`）是装饰，丢弃合理；但序号、行结构、表格单元格边界属于内容，丢弃违背原设计目标——这是当时的实现盲区。

## 3. 方案

新增 remark 插件 `remark-plain-structure`（`packages/app/src/components/remark-plain-structure.ts`），在 mdast 层、hast 过滤**之前**把结构节点还原为带字面标记的段落文本行，行间插入 `\n` 文本节点，交给已有的 `remark-breaks` 转成 `<br>`：

- `list` → 段落文本行：ordered 用 `list.start` 起算生成 `N. ` 前缀（保留用户起始序号），unordered 用 `- `；task list 追加 `[ ] `/`[x] `；嵌套列表递归缩进两个 nbsp（普通空格会被 hast→JSX 空白折叠吃掉）
- `listItem` 内的行内节点（link、code、emphasis）原样保留，不降级为纯字符串
- `table` → 每行单元格用 ` | ` 连接，表头后补 `--- | ---` 分隔行
- `thematicBreak` → 字面 `---`

插件顺序：`[remarkGfm, remarkPlainStructure, remarkBreaks]`（GFM 先解析出 table/taskList，插件改写后再由 remark-breaks 处理软换行）。

已知取舍：

- list item 内的 code 块降级为纯文本行（顶层 code 块仍走 `pre`/`code` 渲染）；多行 code 的内部行首缩进会被行内空白规范化吃掉
- list item 直接子 table 的行不缩进（tableLine 无 indent 语义）
- 空 list item（`-` 单独成行）保留仅含 marker 的行

`allowedElements` 白名单与 `unwrapDisallowed` 保持不变——emphasis/heading 等装饰性降级行为不变。

## 4. 测试

`MarkdownContent.test.tsx` plain 模式新增：序号列表保留数字与 `<br>`、起始序号非 1、无序列表 bullet、列表内链接、task list 标记、嵌套缩进、表格按行分隔、thematic break 字面渲染；既有用例（degrade 断言）全部保持通过。

## 5. 不受影响的部分

- assistant 气泡与 document 视图（非 plain 路径，插件不启用）
- 发送/存储链路（原文不变，复制按钮仍复制原文）
