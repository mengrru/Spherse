# Viewer Card Implementation Plan

> **Mode:** subagent-driven. Tasks are self-contained units with typed interfaces, no file overlap between parallel tasks. Run `npm test --workspace=packages/app` after each task; run `npm run verify` at the end.

**Goal:** 在 agent run 结束（`agent_end`）时，按文件聚合展示 write_file / edit_file 的只读 viewer card。

**Reference:** `docs/dev/features/2026-06-20-viewer-card/design.md`（权威设计文档，所有细节以此为准）

## Dependency Graph (parallelization)

```
Task 1 (types) ──┬─→ Task 3 (aggregate fn)  ──┬─→ Task 5 (reducer)   ──┐
                 │                            │                         ├─→ Task 7 (integration)
Task 2 (plumb) ──┴─→ Task 4 (DiffViewer) ─────┴─→ Task 6 (FileViewerCard)┘   → Task 8 (verify)
```

- **Task 1 + Task 2 fully independent** → run in parallel
- After both: **Task 3 + Task 4 in parallel**
- Then: **Task 5 + Task 6 in parallel**
- **Task 7** (needs 5 + 6) → **Task 8** (verify)

Critical path: 1 → 3 → 5 → 7 → 8.

---

## Task 1: 类型迁移与新增

**Files:**
- New: `packages/app/src/features/chat/types.ts`
- Modify: `packages/app/src/lib/types.ts`
- Modify (imports): `features/chat/chat-session-reducer.ts`, `features/chat/MessageItem.tsx`, `features/chat/MessageList.tsx`, `features/chat/hooks/useChatSession.ts`, `features/chat/hooks/useChatScroll.ts`

**Why first:** All other tasks import from this new types file. No external deps needed.

- [ ] **Step 1:** 创建 `features/chat/types.ts`：
  - `import type { AgentEvent } from "../../lib/types"`（保留向下依赖）
  - **迁入**（从 `lib/types.ts` 原样搬来）：`HtmlCard`、`ToolCallInfo`（含 `_card?`）、`ChatMessage`
  - **新增字段**到 `ChatMessage`：`_runChanges?: FileChangeCard[]`
  - **新增类型**：`FileChangeOp { toolCallId, toolName: "write_file" | "edit_file", args: Record<string, unknown> }`、`FileChangeCard { path: string, ops: FileChangeOp[] }`
- [ ] **Step 2:** 从 `lib/types.ts` **删除** `ChatMessage`、`ToolCallInfo`、`HtmlCard` 三个 interface（保留 contract re-export 块、`ActiveSessionInfo`、`AgentEvent` re-export）
- [ ] **Step 3:** 更新 5 个 chat 内文件的 import：原 `import type { ChatMessage, ToolCallInfo, ... } from "../../lib/types"` 拆分——chat 专属类型改从 `"./types"`（或相对路径 `"../types"`），其余（`AgentProfile`、`AgentEvent`）仍从 `"../../lib/types"`
- [ ] **Step 4:** `npx tsc --noEmit -p packages/app/tsconfig.json` 无类型错误

**Done:** 编译通过，`lib/types.ts` 不再导出 chat 专属类型，chat 内类型自洽。

---

## Task 2: 基础设施（依赖、样式 token、i18n）

**Files:**
- Modify: `packages/app/package.json`
- Modify: `packages/app/src/styles.css`
- Modify: `packages/i18n/src/locales/zh-CN.ts`, `zh-TW.ts`, `en.ts`

**Independent of Task 1.** Run in parallel.

- [ ] **Step 1:** `packages/app` 安装依赖：`diff`（runtime）+ `@types/diff`（dev）。验证 `npm install` 后 `package.json` + `package-lock.json` 更新
- [ ] **Step 2:** `styles.css` 新增 token（按 `--agent-{name}` + `--color-agent-{name}` 约定）：
  - `:root`：`--agent-diff-added: #16a34a;`
  - `@media (prefers-color-scheme: dark) :root`：`--agent-diff-added: #22c55e;`
  - `@theme inline`：`--color-agent-diff-added: var(--agent-diff-added);`
- [ ] **Step 3:** 三语言 locale 新增 key（zh-CN 为基准，每条带场景注释；zh-TW / en 同步）：
  - `viewer-card.old` / `viewer-card.new`（diff 左右栏标题）
  - `viewer-card.emptyContent`（write 空内容占位）
  - `viewer-card.bytes`（write 字节数后缀，含 `{n}` 插值）
  - `viewer-card.occurrence`（edit 替换次数，含 `{n}` 插值）
  - `viewer-card.changeCount`（card 头部 badge，含 `{n}` 插值，n>1 时显示）
- [ ] **Step 4:** `npm run check:i18n` 通过

**Done:** 三语言 key 一致、token 注册、`diff` 可 `import`。

---

## Task 3: 聚合纯函数 + 单测

**Files:**
- New: `packages/app/src/features/chat/lib/aggregate-file-changes.ts`
- New: `packages/app/src/features/chat/lib/aggregate-file-changes.test.ts`

**Depends on:** Task 1（`ChatMessage`、`FileChangeOp`、`FileChangeCard` 类型）

- [ ] **Step 1:** 实现 `aggregateFileChanges(messages: ChatMessage[], runEndIndex: number): FileChangeCard[]`：
  - 从 `runEndIndex` 向前扫描到 run 起点（上一条 `role === "user"` 消息的下一条，或数组起点）
  - 收集范围内所有 assistant 消息中 `status === "completed"` 且 `toolName ∈ {write_file, edit_file}` 的 toolCall
  - 按 `args.path`（string）分组，保持首次出现顺序；每组 `ops` 按 toolCall 出现顺序排列
  - 无匹配返回 `[]`
- [ ] **Step 2:** 实现 `attachRunChanges(messages, runEndIndex, changes)`：向前找到 run 内最后一条 assistant 消息，immutable 写入 `_runChanges`；若无 assistant 消息则原样返回（不挂载）
- [ ] **Step 3:** 导出两个函数
- [ ] **Step 4:** 单测覆盖（参考 design「测试策略」）：
  - 单文件单操作 → 1 card 1 op
  - 单文件 write+edit+edit → 1 card 3 ops（顺序正确）
  - 多文件交错 → 按文件分组、组内顺序正确
  - 跨多条 assistant 消息同一 run → 归入同一聚合
  - 跨 run（user 消息分隔）→ 不混入相邻 run
  - `status === "running"` / `"error"` → 不参与
  - 无 write/edit 完成 → `[]`
- [ ] **Step 5:** `npm test --workspace=packages/app` 通过

**Done:** 纯函数 + 测试全绿，可被 reducer 直接消费。

---

## Task 4: compute-diff + DiffViewer + 单测

**Files:**
- New: `packages/app/src/features/chat/lib/compute-diff.ts`
- New: `packages/app/src/features/chat/DiffViewer.tsx`
- New: `packages/app/src/features/chat/lib/compute-diff.test.ts`

**Depends on:** Task 1（类型，间接）+ Task 2（`diff` 包、`--agent-diff-added` token、`viewer-card.old/new` i18n）

- [ ] **Step 1:** `compute-diff.ts` 实现 `computeLineDiff(oldString: string, newString: string): { left: Line[]; right: Line[] }`：
  - 调用 `diffLines` from `diff`
  - `Line = { type: "removed" | "added" | "unchanged"; text: string }`
  - 对齐成左右两列：removed 行只在 left、added 行只在 right、unchanged 两边都有（left 行序按原 old，right 行序按原 new）
- [ ] **Step 2:** `DiffViewer.tsx`：
  - Props: `{ oldString: string; newString: string }`
  - 两列网格，左标题「Old」右标题「New」（`t("viewer-card.old")` / `t("viewer-card.new")`）
  - 每列 `<pre>` + `max-h-[400px] overflow-auto font-mono text-xs whitespace-pre`
  - 行高亮：removed → `bg-destructive/10`，added → `bg-agent-diff-added/10`，unchanged → 中性
- [ ] **Step 3:** 单测（`compute-diff.test.ts`）：identical、additions-only、removals-only、mixed、多行、`old === new`（无高亮）
- [ ] **Step 4:** `npm test --workspace=packages/app` 通过；`npm run lint --workspace=packages/app` 通过

**Done:** DiffViewer 可独立渲染，输入两个字符串输出行级高亮 diff。

---

## Task 5: Reducer + 历史恢复改动 + 单测

**Files:**
- Modify: `packages/app/src/features/chat/chat-session-reducer.ts`
- Modify: `packages/app/src/features/chat/chat-session-reducer.test.ts`

**Depends on:** Task 1（`_runChanges` 字段）+ Task 3（`aggregateFileChanges`、`attachRunChanges`）

- [ ] **Step 1:** `applyEventToMessages` 的 `agent_end` 分支，在现有「streaming flip」之前插入：
  ```ts
  const runEndIndex = prev.length - 1;
  const changes = aggregateFileChanges(prev, runEndIndex);
  if (changes.length > 0) {
    prev = attachRunChanges(prev, runEndIndex, changes);
  }
  ```
- [ ] **Step 2:** `parseHistoryMessages` 末尾新增后处理：遍历还原后的 messages，按 user 消息界定 run 边界，对每个 run 内最后一条 assistant 消息调用 `aggregateFileChanges` 写入 `_runChanges`（用同一 `attachRunChanges` helper）
- [ ] **Step 3:** 新增测试用例：
  - `agent_end` 事件触发聚合：run 内有 write/edit completed → `_runChanges` 挂到最后一条 assistant 消息
  - run 内无 write/edit → 不挂 `_runChanges`
  - `agent_end` 时仍在 streaming 的消息先翻为非 streaming 再聚合
  - `parseHistoryMessages`：含 write/edit toolCall 的历史 → 对应 run 末尾 assistant 消息带 `_runChanges`
  - `parseHistoryMessages`：多 run（多个 user 消息）→ 各 run 独立聚合
- [ ] **Step 4:** `npm test --workspace=packages/app` 通过（含原有用例不回归）

**Done:** live streaming 与历史恢复都会正确生成 `_runChanges`。

---

## Task 6: FileViewerCard 组件

**Files:**
- New: `packages/app/src/features/chat/FileViewerCard.tsx`

**Depends on:** Task 1（`FileChangeCard` 类型）+ Task 2（i18n keys）+ Task 4（`DiffViewer`）

- [ ] **Step 1:** 实现 `FileViewerCard({ change, onNavigateToPath }: { change: FileChangeCard; onNavigateToPath?: (p: string) => void })`：
  - **头部**：可点击路径（`text-primary underline hover:opacity-80`）+ 操作数 badge（`ops.length > 1` 时显示 `t("viewer-card.changeCount", { n })`）
  - **body**：`max-h-[600px] overflow-auto`，按 `change.ops` 顺序渲染子区块：
    - 子区块头部：工具 badge（`write_file`/`edit_file`，`font-mono`）+ meta（write: `t("viewer-card.bytes", { n: content.length })`；edit: `t("viewer-card.occurrence", { n: replace_all ? count : 1 })`，count 可从 `result` 解析或默认 1）
    - 子区块 body：write → `<pre className="font-mono text-xs whitespace-pre-wrap break-all max-h-[400px] overflow-auto">{content}</pre>`（空内容显示 `t("viewer-card.emptyContent")`）；edit → `<DiffViewer oldString={args.old_string} newString={args.new_string} />`
  - 外层：`rounded-lg border border-border bg-card my-2`
- [ ] **Step 2:** `npm run lint --workspace=packages/app` 通过

**Done:** 给定 `FileChangeCard` 能正确渲染单/多操作卡片。

---

## Task 7: MessageItem 集成 + 结构测试

**Files:**
- Modify: `packages/app/src/features/chat/MessageItem.tsx`
- Modify: `packages/app/src/features/chat/MessageItem.structure.test.ts`

**Depends on:** Task 1（`_runChanges`）+ Task 6（`FileViewerCard`）

- [ ] **Step 1:** `MessageItem.tsx` 在 `<HtmlCardRenderer>` 映射之后追加：
  ```tsx
  {message._runChanges?.map((change) => (
    <FileViewerCard key={change.path} change={change} onNavigateToPath={onNavigateToPath} />
  ))}
  ```
- [ ] **Step 2:** import `FileViewerCard` from `"./FileViewerCard"`
- [ ] **Step 3:** 扩展 `MessageItem.structure.test.ts`：断言源码中 `FileViewerCard` 出现在 `ToolCallSection` 之后（参考现有断言模式）
- [ ] **Step 4:** `npm test --workspace=packages/app` 通过

**Done:** `_runChanges` 在 UI 正确渲染。

---

## Task 8: 最终验证

- [ ] **Step 1:** `npm run verify`（lint + build + core/server/i18n/app 单测 + i18n check）全绿
- [ ] **Step 2:** 启动 `npm run dev`，手动验证：
  1. 触发单次 write_file → run 结束后出现 1 张 card，显示全量内容
  2. 触发单次 edit_file → 出现 1 张 card，左右分栏 diff，removed 红底 / added 绿底
  3. 同文件多次操作（write + edit）→ 1 张 card 内堆叠 2 个子区块
  4. 多文件操作 → 多张 card，按首次操作顺序
  5. 点击 card 头部路径 → 跳转 ContentBrowser 打开该文件
  6. 大文件写入 → card body 内部滚动，不撑爆聊天
  7. 重新打开同一 session（历史恢复）→ card 正常重现，聚合正确
  8. 运行中（未 agent_end）→ 不显示聚合 card，ToolCallSection 正常显示进度
- [ ] **Step 3:** 按 AGENTS.md 更新 `docs/dev/backlog.md`（标记本条目 `[x]`）与 `docs/official/`（若涉及架构/目录变更，如 `project-structure.md` 新增 `features/chat/types.ts`、`FileViewerCard.tsx`、`DiffViewer.tsx`、`lib/` 下两个文件）

**Done:** 全链路验证通过，文档同步。

---

## Notes for subagent dispatch

- **Task 1 必须最先完成**（或至少先 merge），它是所有后续任务的类型基础
- **Task 1 + Task 2 可同时 dispatch**（无文件冲突）
- 每个任务结束时必须跑 `npm test --workspace=packages/app` + `npx tsc --noEmit -p packages/app/tsconfig.json`，确保不破坏主干
- 所有新文件位于 `packages/app/src/features/chat/`（或其 `lib/` 子目录），遵循 chat 自治原则
- 组件不写 `dark:` 修饰符；颜色只用语义 token（`bg-card`、`text-primary`、`bg-destructive/10`、`bg-agent-diff-added/10`）
