# [infra] i18n Migration — Frontend

## 概述

将 `packages/app` 下所有硬编码文案迁移到 `@spherse/i18n`，使前端 UI 支持简体中文（zh-CN）、繁体中文（zh-TW）和英文（en）三语言切换。

## 背景

- `@spherse/i18n` 包已建立，提供了 `translate()`、`useI18n()`、`I18nProvider` 等 API
- 当前已有 17 个 key（全部是 settings 相关），`I18nProvider` 已在 `App.tsx` 挂载
- `packages/app/src/` 下 25 个业务文件中仍有约 100 个硬编码中文文案尚未迁移
- 2 处使用了 `window.confirm()` 需一并替换为 shadcn AlertDialog

## 范围

### 包含

- 所有 `packages/app/src/` 下业务组件、hooks、stores 中的硬编码用户可见文案
- `lib/tool-registry.ts` 中的数据驱动工具标签
- `window.confirm()` 替换为 AlertDialog 组件
- `zh-CN.ts`、`zh-TW.ts`、`en.ts` 三语言 locale 文件同步更新

### 不包含

- `components/ui/` — shadcn 基础组件无业务文案
- 测试文件 — 测试断言字符串固定，不做 i18n
- `console.log`/`console.error` — 开发调试日志不做 i18n
- `packages/core`、`packages/server`、`packages/presets` — 不在本期范围

## 设计决策

### D1: Key 组织策略 — 单文件 + 注释分区

在 `zh-CN.ts` 中保持扁平 key-value 结构，按 feature domain 用注释分隔区块：

```ts
// --- Common ---
"common.cancel": "取消",
"common.delete": "删除",
"common.save": "保存",
"common.saving": "保存中...",
"common.saved": "已保存",
"common.loading": "加载中...",
"common.edit": "编辑",
"common.rename": "重命名",
"common.create": "创建",
"common.back": "返回",
"common.close": "关闭",
"common.add": "添加",
"common.send": "发送",

// --- Activity Bar ---
"activity-bar.settings": "设置",
"activity-bar.settingsTooltip": "设置",
"activity-bar.addProjectTooltip": "添加项目",

// --- Agent Dialog ---
"agent-dialog.createTitle": "创建 Agent",
"agent-dialog.editTitle": "编辑 Agent",
"agent-dialog.nameLabel": "名称",
"agent-dialog.namePlaceholder": "Agent 名称",
"agent-dialog.nameRequired": "请输入 Agent 名称",
"agent-dialog.promptLabel": "提示词",
"agent-dialog.toolsLabel": "工具权限",
"agent-dialog.refsLabel": "参考资料",
"agent-dialog.refsPlaceholder": "输入路径搜索文件，回车添加",
"agent-dialog.saveFailed": "保存失败",

// --- Agent Session List ---
"agent-session-list.newSession": "新建对话",
"agent-session-list.createAgent": "创建 Agent",
"agent-session-list.createAgentTooltip": "创建 Agent",
"agent-session-list.emptyAgents": "暂无 Agent 定义",
"agent-session-list.confirmDeleteAgent": "确定要删除 Agent「{name}」吗？该 Agent 下的所有会话也将被移除。",
"agent-session-list.deleteFailed": "删除失败：{message}",
"agent-session-list.renameFailed": "重命名失败：{message}",
"agent-session-list.sessionNameRequired": "请输入会话名称",
"agent-session-list.sessionNameTooLong": "会话名称不能超过 80 个字符",

// --- Chat ---
"chat.composerPlaceholder": "输入消息... (Shift+Enter 换行)",
"chat.collapse": "收起",
"chat.expand": "展开",
"chat.startConversation": "发送一条消息开始对话",
"chat.saveSuccess": "保存成功",
"chat.saveFailed": "保存失败：{message}",
"chat.fileMustBeInProject": "文件必须保存在项目目录内",
"chat.copyTooltip": "复制",

// --- Content Browser ---
"content-browser.save": "保存",
"content-browser.saving": "保存中...",
"content-browser.editFile": "编辑",
"content-browser.conflictKeepMine": "保留我的修改",
"content-browser.conflictReload": "重新加载文件",
"content-browser.confirmLeaveTitle": "有未保存的修改",
"content-browser.confirmLeaveMessage": "确定离开当前文件并放弃这些修改吗？",
"content-browser.confirmCancelMessage": "确定取消编辑并放弃这些修改吗？",
"content-browser.discardChanges": "放弃修改",
"content-browser.continueEditing": "继续编辑",
"content-browser.saveFailed": "保存失败: {error}",

// --- File Tree ---
"file-tree.newFile": "新建文件",
"file-tree.newFolder": "新建文件夹",
"file-tree.delete": "删除",
"file-tree.confirmDeleteTitle": "确认删除",
"file-tree.confirmDeleteDir": "确定要删除目录「{name}」吗？此操作不可撤销。",
"file-tree.confirmDeleteFile": "确定要删除文件「{name}」吗？此操作不可撤销。",
"file-tree.createFailed": "创建失败：{message}",
"file-tree.deleteFailed": "删除失败：{message}",

// --- AI Read Denylist ---
"ai-read-denylist.title": "AI 读取限制",
"ai-read-denylist.emptyState": "暂无限制路径",
"ai-read-denylist.placeholder": "例如 secrets 或 notes/private.md",
"ai-read-denylist.add": "添加",
"ai-read-denylist.removeLabel": "移除 {path}",
"ai-read-denylist.loadFailed": "读取 AI 读取限制失败：{message}",
"ai-read-denylist.invalidPath": "路径无效或不可加入限制列表",
"ai-read-denylist.pathExists": "路径已存在",
"ai-read-denylist.saved": "AI 读取限制已保存",
"ai-read-denylist.saveFailed": "保存失败：{message}",

// --- Project Panel ---
"project-panel.aiReadDenylistTooltip": "设置 AI 文件读取限制",

// --- Text Selection Session ---
"text-selection.agentPlaceholder": "选择 Agent",
"text-selection.supplementPlaceholder": "添加补充说明（可选）...",
"text-selection.quoteFrom": "引用自 {path}",
"text-selection.promptPrefix": "请处理以下来自「{path}」的内容：\n\n{text}",

// --- Pages ---
"pages.projectNotFound": "项目不存在",

// --- Empty State ---
"empty-state.openProject": "点击左侧 + 打开项目",

// --- Tool Labels ---
"tool.read_file": "读取文件",
"tool.write_file": "写入文件",
"tool.edit_file": "编辑文件",
"tool.list_files": "列出文件",
"tool.search_content": "搜索内容",
"tool.append_log": "追加日志",
"tool.load_skill": "加载技能",
"tool.render_card": "渲染卡片",

// --- Error ---
"error.requestFailed": "请求失败"
```

### D2: 命名规范

**格式**：`{feature-domain}.{element-type}.{description}`

- **feature-domain**：`common`、`activity-bar`、`agent-dialog`、`agent-session-list`、`chat`、`content-browser`、`file-tree`、`ai-read-denylist`、`project-panel`、`text-selection`、`pages`、`empty-state`、`tool`、`error`
- **高频通用词**收归 `common.*`：`cancel`、`delete`、`save`、`saving`、`saved`、`loading`、`edit`、`rename`、`create`、`back`、`close`、`add`、`send`
- **插值语法**：`{varName}`，如 `"确定要删除「{name}」吗？此操作不可撤销。"` → `t("file-tree.confirmDeleteDir", { name: target.name })`

### D3: 组件迁移模式

#### React 组件内 — `useI18n()`

```tsx
const { t } = useI18n();
<Button>{t("common.cancel")}</Button>
<AlertDialogTitle>{t("file-tree.confirmDeleteTitle")}</AlertDialogTitle>
<p>{t("common.loading")}</p>
{saving ? t("common.saving") : t("common.save")}
placeholder={t("chat.composerPlaceholder")}
title={manualExpanded ? t("chat.collapse") : t("chat.expand")}
```

#### Hooks/Stores 中 — `translate()` 直接调用

在 React 组件树外的代码（hooks、stores）中，直接使用 `translate()` 函数：

```tsx
import { translate } from "@spherse/i18n";
import { useAppStore } from "@/stores/app-store";

const locale = useAppStore.getState().locale;
toast.error(translate(locale, "ai-read-denylist.loadFailed", { message: String(err.message) }));
```

#### 数据驱动标签 — `TranslationKey` 引用

`tool-registry.ts` 中的 `label` 字段改为存储翻译 key：

```ts
import { TranslationKey } from "@spherse/i18n";
export const ALL_TOOLS: ToolInfo[] = [
  { id: "read_file", label: "tool.read_file" as const satisfies TranslationKey },
  // ...
];
// 消费处: t(tool.label)
```

### D4: window.confirm 替换

`agent-session-list/index.tsx` 中的 `window.confirm()` 替换为 shadcn AlertDialog：

1. 维护 `deleteTarget: Agent | null` state
2. 点击删除按钮 → 设置 `deleteTarget`
3. 渲染 `<AlertDialog open={!!deleteTarget}>`，内容用 `t("agent-session-list.confirmDeleteAgent", { name: deleteTarget.name })`
4. 确认按钮执行删除并重置 `deleteTarget`

与 `file-tree/DeleteConfirmDialog.tsx` 保持一致模式。

### D5: Locale 文件更新流程

1. 先更新 `zh-CN.ts`（源 of truth），添加所有新 key + UI 上下文注释
2. 同步更新 `zh-TW.ts` 和 `en.ts`，填充对应翻译
3. 运行 `npm run check --workspace=packages/i18n` 验证 key 完整性
4. TypeScript 编译通过 — 三语言 key 类型一致

### D6: zh-CN 注释规范

遵循 AGENTS.md 规范：`zh-CN.ts` 是翻译基准，每条文案必须结合实际 UI 场景写注释：

```ts
// 设置对话框标题
"settings.title": "设置",
// 删除文件确认弹窗的确认按钮
"common.delete": "删除",
```

## 受影响文件清单

### Locale 文件（添加 key）

| 文件 | 说明 |
|------|------|
| `packages/i18n/src/locales/zh-CN.ts` | 添加 ~80 个新 key |
| `packages/i18n/src/locales/zh-TW.ts` | 同步填充繁体中文 |
| `packages/i18n/src/locales/en.ts` | 同步填充英文 |

### 业务组件（硬编码 → t()）

| 文件 | 预估 key 数 |
|------|------------|
| `App.tsx` | 1 |
| `components/AgentDialog.tsx` | 9 |
| `components/EmptyState.tsx` | 1 |
| `features/activity-bar/index.tsx` | 2 |
| `features/agent-session-list/AgentRow.tsx` | 4 |
| `features/agent-session-list/EmptyAgents.tsx` | 1 |
| `features/agent-session-list/SessionRow.tsx` | 4 |
| `features/agent-session-list/index.tsx` | 4 |
| `features/chat/Composer.tsx` | 3 |
| `features/chat/CopyButton.tsx` | 1 |
| `features/chat/HtmlCard.tsx` | 3 |
| `features/chat/MessageList.tsx` | 1 |
| `features/content-browser/ConflictBanner.tsx` | 2 |
| `features/content-browser/ConfirmDialogs.tsx` | 5 |
| `features/content-browser/ContentView.tsx` | 1 |
| `features/content-browser/Header.tsx` | 3 |
| `features/content-browser/index.tsx` | 1 |
| `features/debug-tools/DebugMenu.tsx` | ~7 |
| `features/file-tree/AiReadDenylistDialog.tsx` | 8 |
| `features/file-tree/DeleteConfirmDialog.tsx` | 3 |
| `features/file-tree/FileTreeContextMenu.tsx` | 3 |
| `features/file-tree/index.tsx` | 1 |
| `features/project-panel/index.tsx` | 1 |
| `features/text-selection-session/StartSessionButton.tsx` | 1 |
| `features/text-selection-session/StartSessionPopover.tsx` | 4 |
| `layouts/ProjectLayout.tsx` | 2 |
| `pages/ProjectPage.tsx` | 2 |

### Hooks/Stores（translate() 替换）

| 文件 | 预估 key 数 |
|------|------------|
| `features/file-tree/useAiReadDenylist.ts` | 5 |
| `features/file-tree/hooks/useFileTreeController.ts` | 2 |
| `stores/project-data-store.ts` | 1 |
| `lib/tool-registry.ts` | 8 |

## 验证标准

1. `npm run check --workspace=packages/i18n` — key 完整性检查通过
2. `npm run build --workspace=packages/i18n` — TypeScript 编译通过
3. `npm run build --workspace=packages/app` — 前端编译通过
4. `npm run lint` — lint 检查通过
5. `npm test --workspace=packages/i18n` — 现有 i18n 测试通过
6. 手动验证：切换语言后，所有 UI 文案正确显示对应语言
