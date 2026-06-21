# Viewer Card（write_file / edit_file 内容预览）

## 概述

当模型在一次 agent 运行（agent run）中调用 `write_file` 或 `edit_file` 工具时，在运行结束（`agent_end`）时，**按文件聚合**展示只读的 viewer card：每个被修改的文件渲染一张 card，card 内按时间顺序堆叠该文件的所有变更操作。

- `write_file` 操作：展示模型写入的全量内容
- `edit_file` 操作：以左右分栏 diff 形式展示修改（左 `old_string`、右 `new_string`），按行高亮变更
- card 头部显示被修改文件的路径，点击即跳转到 ContentBrowser 打开该文件
- 同一文件被多次操作时，所有操作聚合到同一张 card 内，避免 card 数量爆炸
- 全程只读，不可编辑

## 背景

当前 `write_file` / `edit_file` 工具调用只在 `ToolCallSection` 中以折叠行的形式展示参数表（`path`、`content` / `old_string` / `new_string` 以纯文本 code 块呈现）。用户难以快速感知模型实际改了什么。`render_card` 工具已有「在消息内渲染富卡片（`HtmlCardRenderer`）」的先例，本 feature 沿用「卡片渲染在消息内」的思路，为写/编辑类工具提供结构化的内容预览。

## 需求

1. 模型在 agent run 中调用 `write_file` / `edit_file` 后，在 `agent_end` 时渲染 viewer card
2. **按文件聚合**：同一文件在同一 agent run 内的多次操作合并为一张 card（非每个 tool call 一张）
3. `write_file` 操作：显示全量模型写入内容
4. `edit_file` 操作：左右分栏 diff，左 = `old_string`，右 = `new_string`，按行高亮 diff 内容
5. card 头部提供被修改文件路径，点击直接在 ContentBrowser 打开
6. viewer 只读
7. 大文件不撑爆聊天界面：内容区限高、内部滚动
8. 历史消息重新加载时 card 能正常恢复（含聚合）

## 关键决策（与用户对齐结果）

| 决策点 | 选择 |
|--------|------|
| 与现有 ToolCallSection 行的关系 | **保留原有折叠行**（运行中实时显示进度），聚合 card 作为独立区块在 run 结束时渲染 |
| 大文件处理 | **max-height + 内部滚动**（始终渲染全量内容，内容区限高 400px） |
| edit_file diff 粒度 | **行级高亮**（removed/added 行着色，非字符级） |
| card 出现时机 | **agent run 结束时**（`agent_end`；运行中不渲染聚合 card，由 ToolCallSection 提供实时进度） |
| 聚合粒度 | **按文件路径聚合**：同一 agent run 内对同一 `path` 的所有 write/edit 操作合并到一张 card |
| 多操作内容展示 | **按时间顺序堆叠**：card 内列出该文件的每次操作（write 显示全量内容，edit 显示 diff），不做合并/折叠 |
| diff 计算 | **引入 `diff` npm 包**（`diffLines()`），可靠且体积小 |
| 类型归属 | **chat 自治**：`ChatMessage`/`ToolCallInfo`/`HtmlCard`（经核查仅 chat 消费）连同新增的 `FileChangeOp`/`FileChangeCard`/`_runChanges` 全部置于 `features/chat/types.ts`；`lib/` 保持纯叶子层、不反向 import feature |

## 技术方案

### 数据来源（无需 core/server 改动）

每次操作所需数据**已全部存在于 `toolCall.args`**：

| 工具 | args 字段 |
|------|-----------|
| `write_file` | `path`, `content` |
| `edit_file` | `path`, `old_string`, `new_string`, `replace_all` |

args 随 toolCall 持久化在 session 历史中，`parseHistoryMessages` 已从 `content.arguments` 还原 `args`。

### 聚合模型

#### Agent run 边界

一次 agent run = 两条 user 消息之间的所有消息（含 assistant、toolResult）。对 live streaming，run 由 `agent_start` → … → `agent_end` 包围；对历史恢复，run 由相邻 user 消息界定。两种场景共用同一套边界检测逻辑：**向前扫描到上一条 user 消息（或数组起点）即为 run 起点**。

#### 数据结构

**类型归属调整**：经核查，`ChatMessage`、`ToolCallInfo`、`HtmlCard` 仅被 `features/chat/` 内部消费（reducer、hooks、组件），`lib/` 是纯叶子层（从不 import 任何 feature）。因此将这些 chat 专属类型从 `lib/types.ts` **迁出**到新建的 `features/chat/types.ts`，并在同一文件新增本次的类型，保证 chat 自治、不污染 lib。

新增文件 `features/chat/types.ts`，内容包含：

```ts
import type { AgentEvent } from "../../lib/types"; // 向下依赖，正常

// —— 从 lib/types.ts 迁入（chat 专属）——
export interface HtmlCard { /* ...原内容... */ }
export interface ToolCallInfo { /* ...原内容，含 _card? —— */ }
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  _streaming?: boolean;
  _toolCalls?: ToolCallInfo[];
  _error?: string;
  _runChanges?: FileChangeCard[]; // 仅挂在 agent run 的最后一条 assistant 消息上
}

// —— 本次新增 ——
export interface FileChangeOp {
  toolCallId: string;
  toolName: "write_file" | "edit_file";
  args: Record<string, unknown>; // path, content | old_string, new_string, replace_all
}

export interface FileChangeCard {
  path: string;
  ops: FileChangeOp[]; // 同一文件的多次操作，按时间顺序
}
```

`lib/types.ts` 同步**移除** `ChatMessage`、`ToolCallInfo`、`HtmlCard`（保留 contract re-export 如 `AgentProfile`、`SessionInfo`，以及 `ActiveSessionInfo`、`AgentEvent` re-export）。chat 内原先 `import ... from "../../lib/types"` 改为 `from "./types"`（或相对路径）。

#### 聚合函数（纯函数，可单测）

新增 `features/chat/lib/aggregate-file-changes.ts`：

```ts
export function aggregateFileChanges(messages: ChatMessage[], runEndIndex: number): FileChangeCard[] {
  // 1. 从 runEndIndex 向前扫描到 run 起点（上一条 user 消息或数组起点）
  // 2. 收集该范围内所有 assistant 消息中 status === "completed" 的 write_file/edit_file toolCall
  // 3. 按 args.path 分组，保持出现顺序
  // 4. 每组生成一个 FileChangeCard { path, ops[] }
  // 5. 返回 FileChangeCard[]（按首次出现顺序）
}
```

- 仅收集 `status === "completed"` 的调用（running/error 不参与聚合）
- 同一文件多次操作：ops 数组按 tool call 出现顺序排列
- 同一 path 的 ops 去重不需要（toolCallId 天然唯一）

### 数据流

**Live streaming**：

```
agent_start
  → 多轮 tool_execution_start/end（write_file/edit_file 完成，ToolCallSection 实时显示）
agent_end
  → chat-session-reducer 检测 agent_end
  → 调用 aggregateFileChanges(messages, lastIndex)
  → 将结果挂到 run 最后一条 assistant 消息的 _runChanges
  → MessageItem 渲染 _runChanges → 每个文件一张 FileViewerCard
```

**History restore**：

```
parseHistoryMessages(history)
  → 还原消息数组（含每个 assistant 消息的 _toolCalls + args）
  → 后处理：遍历消息，识别 run 边界（user 消息界定）
  → 对每个 run 的最后一条 assistant 消息调用 aggregateFileChanges 并写入 _runChanges
```

历史恢复**需要新增 run 边界检测 + 聚合后处理**（不同于 `render_card` 的无脑还原）。

### chat-session-reducer 改动

`applyEventToMessages` 在 `event.type === "agent_end"` 分支新增逻辑：

```ts
if (event.type === "agent_end") {
  // 现有：把最后一条 streaming 消息翻为非 streaming
  // 新增：若 run 内有 write/edit tool call，计算聚合并挂到 run 最后一条 assistant 消息
  const runEndIndex = messages.length - 1;
  const changes = aggregateFileChanges(messages, runEndIndex);
  if (changes.length > 0) {
    // 找到 run 范围内最后一条 assistant 消息，挂上 _runChanges
    messages = attachRunChanges(messages, runEndIndex, changes);
  }
  // ...existing streaming flip...
}
```

`attachRunChanges` 辅助函数：向前扫描找到最后一条 assistant 消息（同一 run 内）， immutable 地写入 `_runChanges`。

### parseHistoryMessages 改动

在现有还原逻辑之后，新增后处理步骤：

```ts
// 1. 识别 run 边界（user 消息索引）
// 2. 对每个 run，定位其范围内最后一条 assistant 消息
// 3. 调用 aggregateFileChanges 并写入该消息的 _runChanges
```

### 渲染位置

`MessageItem.tsx` 中，在 `<ToolCallSection>` 与 `HtmlCardRenderer` 之后，渲染当前消息的 `_runChanges`：

```tsx
{message._toolCalls && message._toolCalls.length > 0 && (
  <ToolCallSection toolCalls={message._toolCalls} onNavigateToPath={onNavigateToPath} />
)}
{message._error && <ErrorMessageSection error={message._error} />}
{message._toolCalls?.filter((tc) => tc._card).map((tc) => (
  <HtmlCardRenderer key={tc.toolCallId} card={tc._card!} />
))}
{message._runChanges?.map((change) => (
  <FileViewerCard key={change.path} change={change} onNavigateToPath={onNavigateToPath} />
))}
```

`onNavigateToPath` 已从 `ChatPage → MessageList → MessageItem` 透传到位，直接复用。

### 新增组件（位于 `features/chat/`，chat 专属）

#### `FileViewerCard.tsx`

容器组件，按文件聚合。

```tsx
interface FileViewerCardProps {
  change: FileChangeCard;
  onNavigateToPath?: (path: string) => void;
}
```

结构：

- **头部**：可点击文件路径（`text-primary underline`）+ 操作数 badge（`{n} change(s)`，n > 1 时显示）
- **body**：按 `ops` 数组顺序渲染每个操作为子区块
  - 子区块头部：工具 badge（`write_file` / `edit_file`，font-mono）+ 操作级 meta
    - `write_file`：内容字节数（`{n} bytes`）
    - `edit_file`：替换次数（`replace_all ? multiple : 1 occurrence`）
  - 子区块 body：
    - `write_file` → write-view（全量内容 `<pre>`）
    - `edit_file` → `<DiffViewer oldString={args.old_string} newString={args.new_string} />`
- 外层样式：`rounded-lg border border-border bg-card`，宽度跟随消息气泡
- 整个 card body `max-h-[600px] overflow-auto`（多操作时整体可滚）

#### `DiffViewer.tsx`

edit_file 左右分栏 diff（不变）。

```tsx
interface DiffViewerProps {
  oldString: string;
  newString: string;
}
```

- 调用 `diffLines(oldString, newString)` 得到变更块序列，对齐成左右两列行数组
- 两列网格布局：左列标题「Old」、右列标题「New」（muted 文字）
- 每列 `<pre>`，`max-h-[400px] overflow-auto font-mono text-xs whitespace-pre`
- 行级高亮：
  - removed 行（仅出现在 old 侧）→ `bg-destructive/10`
  - added 行（仅出现在 new 侧）→ `bg-agent-diff-added/10`
  - 未变更行 → 中性背景

#### `features/chat/lib/aggregate-file-changes.ts`

聚合纯函数（见上文「聚合函数」）。

#### `features/chat/lib/compute-diff.ts`（可选薄封装）

将 `diffLines()` 输出归约为对齐的 `{ left: Line[]; right: Line[] }` 结构（每行带 `type: 'removed' | 'added' | 'unchanged'`）。若逻辑简单也可内联在 `DiffViewer` 中。

### write_file view 细节

- `<pre>` 渲染 `args.content`，`font-mono text-xs whitespace-pre-wrap break-all`
- `max-h-[400px] overflow-auto`（限高滚动）
- 空内容（`content === ""`）：显示 muted 占位文案（i18n key）

### edit_file diff 细节

- 仅用 `old_string` 与 `new_string` 做对比（客户端无整文件内容，不展示整文件 diff）
- `old_string === new_string`：两侧完全一致，无高亮（合法 no-op）
- `replace_all`：单个 `old_string`/`new_string` 的 diff；子区块头部展示替换次数

### 新增样式 token

当前 `styles.css` 无绿色 token。按 `--agent-{name}` + `--color-agent-{name}` 约定新增（removed 复用现有 `--destructive`）：

```css
/* :root */
--agent-diff-added: #16a34a;
/* @media (prefers-color-scheme: dark) :root */
--agent-diff-added: #22c55e;
/* @theme inline */
--color-agent-diff-added: var(--agent-diff-added);
```

业务组件不写 `dark:` 修饰符，由变量自动切换（符合前端样式规范）。

### 新增依赖

`packages/app` 新增：

- `diff`（运行时）
- `@types/diff`（dev）

### i18n

新增 key（`zh-CN` 为基准，同步 `zh-TW`、`en`，每条配场景注释）：

| key | 用途 |
|-----|------|
| `viewer-card.old` | diff 左栏标题「Old」 |
| `viewer-card.new` | diff 右栏标题「New」 |
| `viewer-card.emptyContent` | write_file 空内容占位 |
| `viewer-card.bytes` | write_file 字节数后缀 |
| `viewer-card.occurrence` | edit_file 替换次数说明 |
| `viewer-card.changeCount` | card 头部操作数 badge（`{n} change(s)`，n>1 时显示） |

### 涉及文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/app/src/features/chat/FileViewerCard.tsx` | 按文件聚合的 viewer card 容器 |
| 新增 | `packages/app/src/features/chat/DiffViewer.tsx` | edit_file 左右分栏 diff |
| 新增 | `packages/app/src/features/chat/types.ts` | chat 专属类型：迁入 `ChatMessage`/`ToolCallInfo`/`HtmlCard`，新增 `FileChangeOp`/`FileChangeCard` 与 `_runChanges` 字段 |
| 新增 | `packages/app/src/features/chat/lib/aggregate-file-changes.ts` | run 级聚合纯函数 |
| 新增（可选） | `packages/app/src/features/chat/lib/compute-diff.ts` | diffLines 归约封装 |
| 修改 | `packages/app/src/lib/types.ts` | **移除** `ChatMessage`/`ToolCallInfo`/`HtmlCard`（迁入 features/chat/types.ts）；保留 contract re-export 与 `ActiveSessionInfo`/`AgentEvent` |
| 修改 | chat 内 5 个引用处（`chat-session-reducer.ts`、`MessageItem.tsx`、`MessageList.tsx`、`hooks/useChatSession.ts`、`hooks/useChatScroll.ts`） | `import ... from "../../lib/types"` 中 ChatMessage/ToolCallInfo 改从 `./types`（或相对路径）引入 |
| 修改 | `packages/app/src/features/chat/MessageItem.tsx` | 渲染 `message._runChanges` → FileViewerCard |
| 修改 | `packages/app/src/features/chat/chat-session-reducer.ts` | `agent_end` 时调用聚合，挂到 run 末尾 assistant 消息 |
| 修改 | `packages/app/src/features/chat/chat-session-reducer.test.ts` | 新增 agent_end 聚合用例 |
| 修改 | `packages/app/src/features/chat/MessageItem.structure.test.ts` | 结构断言：`_runChanges` 渲染在 ToolCallSection 之后 |
| 新增 | `packages/app/src/features/chat/lib/aggregate-file-changes.test.ts` | 聚合单测（含多文件、多操作、跨消息） |
| 新增 | `packages/app/src/features/chat/lib/compute-diff.test.ts`（或 DiffViewer 测试） | diff 对齐单测 |
| 修改 | `packages/app/src/styles.css` | 新增 `--agent-diff-added` / `--color-agent-diff-added` |
| 修改 | `packages/app/package.json` | 新增 `diff` + `@types/diff` 依赖 |
| 修改 | `packages/i18n/src/locales/zh-CN.ts` | 新增 viewer-card.* 翻译（基准） |
| 修改 | `packages/i18n/src/locales/zh-TW.ts` | 同步翻译 |
| 修改 | `packages/i18n/src/locales/en.ts` | 同步翻译 |

### 不变的部分

- core / server / Electron 层完全不变
- WebSocket 事件流不变（`agent_end` 等事件本就透传）
- 现有 `ToolCallSection` 折叠行逻辑与样式不变（运行中实时进度仍由它展示）
- `HtmlCardRenderer` 渲染逻辑不变
- `onNavigateToPath` 透传链路不变
- ContentBrowser 打开/返回逻辑不变

> 注：`chat-session-reducer` 与 `parseHistoryMessages` 本次**有改动**（新增 agent_end 聚合与历史 run 边界检测），不再属于「不变」。
>
> 注：`lib/types.ts` 本次**有改动**（迁出 chat 专属类型到 `features/chat/types.ts`），不再属于「不变」。

## 测试策略

- **单元测试**（`packages/app`）
  - `aggregate-file-changes`：
    - 单文件单操作 → 1 card 1 op
    - 单文件多操作（write + edit + edit）→ 1 card 3 ops，顺序正确
    - 多文件交错操作 → 按文件分组，每组顺序正确
    - 跨多条 assistant 消息的同一 run → 全部归入同一聚合
    - 跨 run（被 user 消息分隔）→ 不混入相邻 run
    - `status === "running"` / `"error"` → 不参与聚合
    - 无 write/edit 操作的 run → 返回空数组
  - `compute-diff` / `DiffViewer`：identical、additions-only、removals-only、mixed、多行、`replace_all` 场景
  - `chat-session-reducer`：`agent_end` 事件触发聚合、`_runChanges` 挂到正确消息
  - `parseHistoryMessages`：历史消息恢复后 `_runChanges` 正确重建
  - 扩展 `MessageItem.structure.test.ts`：`_runChanges` 渲染在 ToolCallSection 之后
- **i18n 校验**：`npm run check:i18n` 通过（新 key 三语言一致）
- **lint / typecheck**：`npm run verify`
- **手动测试**：触发多文件、同文件多次操作的 agent run，验证聚合、diff 高亮、路径跳转、大文件滚动、历史恢复

## 边界与错误处理

| 场景 | 行为 |
|------|------|
| run 进行中（未 `agent_end`） | 不渲染聚合 card（ToolCallSection 实时显示进度） |
| 某 toolCall `status === "error"` | 该调用不参与聚合；其余成功调用正常聚合 |
| run 内无任何 write/edit 完成 | 不挂 `_runChanges`，不渲染 card |
| 同一文件多次操作 | 聚合到同一 card，ops 数组按时间顺序堆叠 |
| 多个文件被修改 | 每个文件一张 card，按首次操作顺序排列 |
| `content === ""`（write_file） | 该 op 子区块显示空内容占位 |
| `old_string === new_string` | 该 op 的 diff 两侧一致、无高亮 |
| `replace_all` true | 该 op 单个 old/new diff，子区块头部显示次数 |
| 超长单行 | `whitespace-pre-wrap break-all` 自动换行 |
| 大文件 | 内容区 `max-h-[400px] overflow-auto` |
| 历史消息重载 | run 边界由 user 消息界定，聚合正常重建 |
| run 最后一条消息不是 assistant（罕见） | 向前扫描到 run 内最后一条 assistant 消息挂载 |
