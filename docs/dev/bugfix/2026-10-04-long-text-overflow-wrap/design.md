# 修复长文本（长 URL/路径/错误消息）多处 UI 不折行溢出

- 日期：2026-10-04
- 状态：已实施（lint、typecheck、app 单测通过；已过 code review）
- 类型：bugfix（渲染样式）
- 影响范围：`packages/app`（content browser、markdown 渲染、chat 卡片、alert dialog）

## 1. 问题

用户反馈 content browser、alert 等处长文本（如长 URL）单行溢出容器。排查确认全站无一处全局 `overflow-wrap` 设置（`styles.css` 的 base 层只有 scrollbar/button/input 规则，Tailwind v4 preflight 也不设 `overflow-wrap`），全站默认 `overflow-wrap: normal`——无空格 token 的长字符串（URL、路径、hash）在任何未显式处理的容器都会横向溢出。

## 2. 根因分析

逐类布局上下文的折行语义差异是本次修复的关键背景：

| CSS 属性 | 是否参与 min-content intrinsic size | 含义 |
|---|---|---|
| `overflow-wrap: break-word`（`break-words`） | 否 | 行盒溢出时才允许断词；flex/grid item、table cell 的 `min-width: auto` 仍取整个长词宽度 |
| `overflow-wrap: anywhere`（`wrap-anywhere`） | 是 | intrinsic size 按「可断」计算，min-content 收缩为约单字符宽 |
| `word-break: break-all`（`break-all`） | 是 | 任意字符间断行，同样影响 min-content |

因此同样的长 URL：块级容器里 `break-words` 即可；flex/grid/table 布局里 `break-words` 不生效，需要 `anywhere` / `break-all`，或给 flex item 加 `min-w-0` 让盒子先收缩到容器宽。

具体受损位置（均为展示用户数据/动态错误消息、且所在布局链路无折行兜底）：

| 位置 | 问题 |
|---|---|
| `content-browser/index.tsx` 保存失败横幅 | `saveError` 常含完整路径，横幅无折行 |
| `content-browser/ContentView.tsx` 错误展示 `<p>` | server 错误消息可含长路径/URL |
| `MarkdownContent.tsx` 根容器 | 链接 `<a>`、行内 `<code>` 无折行；chat 气泡靠 `UserBubble`/`AssistantBubble` 的 `break-words` 继承兜底，document 变体（content browser）与 UpdateChecker release notes 无兜底 |
| `chat/ToolItemView.tsx` path 按钮 | 工具参数 path 在 auto table layout 里，`whitespace-pre-wrap` 不影响 min-content，长路径撑爆表格 |
| `chat/QuestionCard.tsx` question/answer | 仅 `whitespace-pre-wrap`，agent 提问可含长 URL |
| `chat/ImageCard.tsx` 错误卡片 | `errorMessage` 无折行，且在 `flex flex-col items-center` 内（fit-content 宽度） |
| `ui/alert-dialog.tsx` `AlertDialogDescription` | `text-balance` 不折断长词；dialog 是 grid 布局，插值进来的文件名/server 名可超宽 |

已确认安全无需修改：toast（Sonner 自带 `[data-sonner-toast]{overflow-wrap:anywhere}`）、header 路径与各类 tab/row（`truncate` 单行省略是有意设计）、`FileViewerCard`（`break-all`）、`ErrorMessageSection` / CommandCard / ApprovalCard 的 `pre`（`break-all`）、DiffViewer（`overflow-auto` 横向滚动是 diff 的合理交互）、`MemoryDialog` / `MobileAccessPanel`（已有 `break-words`）。

## 3. 方案

不动全局 `styles.css`（避免全站布局面变化），按项目「只用 Tailwind 工具类」约定逐点修，属性选择与所在布局匹配：

| 位置 | 修复 |
|---|---|
| `MarkdownContent` 根容器 | 加 `break-words`，经继承一次覆盖 `a`/行内 `code`/`p`/`li`，同时修好 content browser 文档视图与 UpdateChecker |
| ContentView 错误 `<p>`、保存失败横幅 | 加 `break-words`（确定宽度块容器） |
| `ToolItemView` path 按钮 | 加 `break-all`（table 布局需影响 min-content；与同文件 `code` 值分支的既有 `break-all` 风格一致） |
| `QuestionCard` question/answer | 加 `break-words`（question `<p>` 已有 `min-w-0` 可收缩） |
| `ImageCard` 错误卡片 | span 加 `max-w-full break-words`，内层 flex column div 加 `min-w-0`（否则 div 作为 flex item `min-width: auto` 不收缩，百分比 max-width 解析无效） |
| `AlertDialogDescription` | 加 `wrap-anywhere`（`anywhere` 参与 min-content 计算，grid auto track 不会被长词撑爆；`break-words` 在此布局无效） |
| `ImageCard` 错误卡片容器 | `h-32` → `min-h-32`（折行后高度增加，固定高度会垂直溢出） |

已验证不引入回归：CodeBlock `pre` 保持 UA 默认 `white-space: pre`（soft wrap 被禁用时 `overflow-wrap` 无从生效），横向滚动行为不变；markdown 表格包裹层 `overflow-x-auto` 维持横向滚动；`text-balance` 与 `wrap-anywhere` 共存无冲突。

## 4. 测试

样式类改动，renderer 测试不覆盖 CSS class，既有用例全部保持通过（164 files / 1343 tests）。浏览器实测建议：>50 字符 URL 在 DeleteConfirmDialog、content browser markdown 文档、工具 path 参数处各验证一次。

## 5. 不受影响的部分

- chat 气泡文本（`UserBubble`/`AssistantBubble` 原有 `break-words + min-w-0`，本次根容器新增为纵深防御）
- toast（Sonner 自带 `overflow-wrap: anywhere`）
- 所有 `truncate` 位置（单行省略是有意设计，未误改）
