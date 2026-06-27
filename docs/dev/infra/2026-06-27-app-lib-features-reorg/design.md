# app 前端 lib/ 与 feature 边界整理

## 背景

`packages/app/src/lib/` 混入了只被单个 feature 使用的代码（`tool-registry.ts`、`avatar-color.ts`、`agent-markdown.ts`），以及一个命名有歧义的 `context.ts`（与 `src/context/` 目录同名，且它本身并非 React Context）。这些违反了 AGENTS.md「只被单个 feature 使用的状态不提升到全局」「feature 私有代码归位」的组织原则。

## 目标

1. 让 `lib/` 只保留真正跨 feature / 跨 store 共享的基础设施。
2. feature 私有代码归位到各自 feature 目录。
3. 消除 `lib/context.ts` 与 `context/` 的命名歧义，让 React Context 的值契约（`AppContext`）与 React Context（`ProjectProvider`/`useProjectCtx`）同居于 `context/` 目录。

不做架构层级的改动（不合并 store 与 Context）——当前 Zustand `app-store`（可变业务状态）+ React `ProjectProvider`（稳定只读依赖注入）的双层划分符合 AGENTS.md 规范，仅整理位置与命名。

## 现状盘点

### 待移动文件及其唯一消费者

| 文件 | 类型 | 唯一消费者 |
|---|---|---|
| `lib/tool-registry.ts` | feature 私有 | `features/agent-session-list/AgentDialog.tsx` |
| `lib/agent-markdown.ts` | feature 私有 | `features/agent-session-list/AgentDialog.tsx` |
| `lib/avatar-color.ts` | feature 私有 | `features/activity-bar/ProjectAvatar.tsx` |
| `lib/context.ts` | 跨层共享（类型）+ 私有（工厂） | `AppContext` 类型：`context/project-context.tsx`、`stores/app-store.ts`；`initAppContext` 工厂：仅 `stores/app-store.ts` |

### AgentDialog 依赖

`features/agent-session-list/AgentDialog.tsx`（275 行，含 `ToolPicker`/`ContextPathField`/`PromptTemplatePicker` 子组件）依赖：
- `lib/agent-markdown.ts`（parse/build）
- `lib/tool-registry.ts`（TOOL_GROUPS）
- `features/agent-session-list/SearchFileField.tsx`（同样只被 AgentDialog 使用）

### 真正应留在 `lib/` 的共享基础设施

`api.ts`、`types.ts`、`utils.ts`（`cn`，被 shadcn UI 全员引用）、`events.ts`、`electron-api.ts`、`use-project-navigation.ts`、`localstorage/`、`api.test.ts`——均被 3+ feature / stores 跨层引用。

## 设计

整理分 3 个相互独立的 chunk，可分别落地、分别验证。

### Chunk A — 提取 `features/agent-dialog/` 独立 feature

新建 `features/agent-dialog/`，移入下列文件（当前均只服务 AgentDialog）：

| 来源 | 目标 |
|---|---|
| `features/agent-session-list/AgentDialog.tsx` | `features/agent-dialog/AgentDialog.tsx` |
| `features/agent-session-list/AgentDialog.structure.test.ts` | `features/agent-dialog/AgentDialog.structure.test.ts` |
| `features/agent-session-list/SearchFileField.tsx` | `features/agent-dialog/SearchFileField.tsx` |
| `lib/tool-registry.ts` | `features/agent-dialog/tool-registry.ts` |
| `lib/agent-markdown.ts` | `features/agent-dialog/agent-markdown.ts` |

引用更新：
- `features/agent-session-list/index.tsx`：`import { AgentDialog } from "./AgentDialog"` → `from "../agent-dialog"`。
- 移动后的文件内部相对路径不变（`tool-registry` 与 `agent-markdown` 同目录，互引仍成立；`AgentDialog` → `SearchFileField` 同目录；`AgentDialog` → `../../lib/types` 仍成立）。

`SearchFileField.tsx` 内部用到 `useProjectCtx`（`../../context/project-context`），移到 `features/agent-dialog/` 后路径变 `../../context/project-context`（同层），无需改。

### Chunk B — `lib/context.ts` 并入 `context/`

新建 `context/app-context.ts`，承载 `AppContext` 接口 + `initAppContext` 工厂。`context/project-context.tsx` 改 `import type { AppContext } from "./app-context"`（同时修正当前令人困惑的 `import ... from "./context"`——该路径在 `context/` 目录内指向自身，语义不清）。`stores/app-store.ts` 改 `from "../context/app-context"`。删除 `lib/context.ts`。

整理后 `context/` 目录拥有 React Context 及其值契约：
- `context/app-context.ts`：`AppContext` 接口 + `initAppContext` 工厂
- `context/project-context.tsx`：`ProjectProvider` + `useProjectCtx` + `useProjectCtxOrNull`

### Chunk C — `lib/avatar-color.ts` 归位

移入 `features/activity-bar/avatar-color.ts`，更新 `features/activity-bar/ProjectAvatar.tsx` 引用为 `./avatar-color`。

## 验证

每个 chunk 完成后：
- `npm run lint --workspace=packages/app`
- `npm test --workspace=packages/app`
- typecheck（lint 已含 / 或 `tsc --noEmit`）

全部完成后跑 `npm run verify` 确认无回归。

## 文档同步

本次为纯结构整理，无行为变更、无新增目录命名约定，`docs/official/` 无需更新。
