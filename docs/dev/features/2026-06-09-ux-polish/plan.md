# UX 小优化合集 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5 项独立的前端 UX 优化，涉及文本选中工具条化、发送至当前 session、session 删除确认、agent 行高亮、agent 列表默认全部折叠。

**Architecture:** 纯前端变更，不涉及 core/server 层。所有改动在 `packages/app` 和 `packages/i18n` 中完成。5 个 Task 相互独立，可并行执行。

**Tech Stack:** React + TypeScript, Zustand stores, Radix UI (Collapsible, AlertDialog), Tailwind CSS, @spherse/i18n

---

## 涉及文件总览

| 文件 | 操作 | Task |
|------|------|------|
| `packages/app/src/features/text-selection-session/StartSessionButton.tsx` → 重命名为 `TextSelectionToolbar.tsx` | 重构 | 1 |
| `packages/app/src/features/text-selection-session/index.tsx` | 修改 | 1, 2 |
| `packages/app/src/features/text-selection-session/StartSessionPopover.tsx` | 修改 | 2 |
| `packages/app/src/features/content-browser/index.tsx` | 修改 | 2 |
| `packages/app/src/stores/project-data-store.ts` | 修改 | 2 |
| `packages/app/src/layouts/ProjectLayout.tsx` | 修改 | 2 |
| `packages/app/src/features/agent-session-list/index.tsx` | 修改 | 3 |
| `packages/app/src/features/agent-session-list/AgentGroup.tsx` | 修改 | 4 |
| `packages/app/src/features/agent-session-list/AgentRow.tsx` | 修改 | 4 |
| `packages/i18n/src/locales/zh-CN.ts` | 修改 | 5 |
| `packages/i18n/src/locales/zh-TW.ts` | 修改 | 5 |
| `packages/i18n/src/locales/en.ts` | 修改 | 5 |

---

### Task 1: 选中文本工具条化（复制 + 开始会话）

**Files:**
- Refactor: `packages/app/src/features/text-selection-session/StartSessionButton.tsx` → `TextSelectionToolbar.tsx`
- Modify: `packages/app/src/features/text-selection-session/index.tsx`

- [ ] **Step 1: 创建 `TextSelectionToolbar.tsx`，替代 `StartSessionButton.tsx`**

删除 `StartSessionButton.tsx`，新建 `TextSelectionToolbar.tsx`：

```tsx
import { useRef } from "react";
import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";
import { useDismissable } from "../../hooks/useDismissable";
import { CopyIcon, MessageCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface TextSelectionToolbarProps {
  position: { x: number; y: number };
  selectedText: string;
  onStart: () => void;
  onCopy: () => void;
  onClose: () => void;
}

export function TextSelectionToolbar({ position, selectedText, onStart, onCopy, onClose }: TextSelectionToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useDismissable({ ref, onDismiss: onClose });

  return (
    <div
      ref={ref}
      className="fixed z-50 flex -translate-x-1/2 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-border/60"
      style={{ left: position.x, top: position.y }}
      data-testid="text-selection-toolbar"
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 rounded-none px-2 text-xs hover:bg-accent"
        onMouseDown={(event) => {
          event.stopPropagation();
          event.preventDefault();
          navigator.clipboard.writeText(selectedText).then(() => {
            onCopy();
          }).catch(() => {});
        }}
        title={t("text-selection.copy")}
      >
        <CopyIcon className="size-3.5" />
      </Button>
      <div className="w-px bg-border" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 rounded-none px-2 text-xs hover:bg-accent"
        onMouseDown={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onStart();
        }}
      >
        <MessageCircleIcon className="size-3.5" />
        {t("text-selection.startSession")}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: 更新 `index.tsx` 引用**

在 `packages/app/src/features/text-selection-session/index.tsx` 中：

1. 将 `import { StartSessionButton }` 改为 `import { TextSelectionToolbar }`
2. 更新接口，新增 `onCopy` 回调行为（直接在组件内实现）

当前 `index.tsx` 的 `StartSessionButton` 用法（第 39-45 行）：

```tsx
{selectionState && !showStartPopover && (
  <StartSessionButton
    position={selectionState.position}
    onStart={() => setShowStartPopover(true)}
    onClose={clearSelection}
  />
)}
```

替换为：

```tsx
{selectionState && !showStartPopover && (
  <TextSelectionToolbar
    position={selectionState.position}
    selectedText={selectionState.text}
    onStart={() => setShowStartPopover(true)}
    onCopy={clearSelection}
    onClose={clearSelection}
  />
)}
```

- [ ] **Step 3: 删除 `StartSessionButton.tsx`**

```bash
rm packages/app/src/features/text-selection-session/StartSessionButton.tsx
```

- [ ] **Step 4: 验证编译通过**

```bash
npm run build --workspace=packages/app
```

---

### Task 2: 发送至当前 Session

**Files:**
- Modify: `packages/app/src/features/text-selection-session/StartSessionPopover.tsx`
- Modify: `packages/app/src/features/text-selection-session/index.tsx`
- Modify: `packages/app/src/features/content-browser/index.tsx`
- Modify: `packages/app/src/stores/project-data-store.ts`
- Modify: `packages/app/src/layouts/ProjectLayout.tsx`

- [ ] **Step 1: 扩展 `StartSessionPopover` 接口，新增"发送至当前会话"按钮**

修改 `StartSessionPopoverProps`：

```ts
interface StartSessionPopoverProps {
  selectedText: string;
  sourcePath: string;
  agents: AgentProfile[];
  position: { x: number; y: number };
  currentSessionInfo?: { sessionId: string; agentName: string } | null;
  onSubmit: (agentId: string, comment?: string) => void;
  onSendToCurrentSession?: (comment?: string) => void;
  onClose: () => void;
}
```

在 agent 列表区域（第 89-103 行）之前，插入"发送至当前会话"按钮：

```tsx
{(onSendToCurrentSession) && (
  <div className="mb-1">
    <Button
      variant="ghost"
      className="w-full justify-between"
      disabled={!currentSessionInfo}
      onClick={() => onSendToCurrentSession(trimmedComment || undefined)}
      title={currentSessionInfo ? undefined : t("text-selection.noActiveSession")}
    >
      <span>{t("text-selection.sendToCurrentSession")}</span>
      {currentSessionInfo && (
        <span className="text-[11px] text-muted-foreground">{currentSessionInfo.agentName}</span>
      )}
    </Button>
  </div>
)}
```

注意：当 `currentSessionInfo` 为 `null` 时，按钮 `disabled`，hover 显示 tooltip "无活动会话"。

- [ ] **Step 2: 扩展 `TextSelectionSession` 接口透传 props**

修改 `packages/app/src/features/text-selection-session/index.tsx`：

1. `TextSelectionSessionProps` 新增：

```ts
currentSessionInfo?: { sessionId: string; agentName: string } | null;
onSendToCurrentSession?: (selectedText: string, sourcePath: string, comment?: string) => void;
```

2. 在 `StartSessionPopover` 渲染处（约第 49-65 行）透传新 props：

```tsx
<StartSessionPopover
  selectedText={selectionState.text}
  sourcePath={sourcePath}
  agents={agents}
  position={selectionState.position}
  currentSessionInfo={currentSessionInfo}
  onSubmit={(agentId, comment) => {
    onStartSession?.(agentId, selectionState.text, sourcePath, comment);
    setShowStartPopover(false);
    clearSelection();
  }}
  onSendToCurrentSession={(comment) => {
    onSendToCurrentSession?.(selectionState.text, sourcePath, comment);
    setShowStartPopover(false);
    clearSelection();
  }}
  onClose={() => {
    setShowStartPopover(false);
    clearSelection();
  }}
/>
```

- [ ] **Step 3: 扩展 `ContentBrowser` 接口**

修改 `packages/app/src/features/content-browser/index.tsx`：

1. `ContentBrowserProps` 新增：

```ts
currentSessionInfo?: { sessionId: string; agentName: string } | null;
onSendToCurrentSession?: (selectedText: string, sourcePath: string, comment?: string) => void;
```

2. 透传给 `TextSelectionSession`（第 74-79 行）：

```tsx
<TextSelectionSession
  disabled={editor.isEditing}
  sourcePath={filePath}
  agents={agents}
  currentSessionInfo={currentSessionInfo}
  onStartSession={onStartSession}
  onSendToCurrentSession={onSendToCurrentSession}
>
```

- [ ] **Step 4: 在 `project-data-store` 新增 `setInitialMessage` 方法**

修改 `packages/app/src/stores/project-data-store.ts`：

1. 在 `ProjectDataStore` 接口中新增：

```ts
setInitialMessage: (projectKey: string, sessionId: string, message: string) => void;
```

2. 在 store 实现中新增（`consumeInitialMessage` 之前）：

```ts
setInitialMessage(projectKey, sessionId, message) {
  set((state) => updateProjectData(state, projectKey, (project) => ({
    ...project,
    initialMessageBySessionId: {
      ...project.initialMessageBySessionId,
      [sessionId]: message,
    },
  }), { createIfMissing: false }));
},
```

- [ ] **Step 5: 在 `ProjectLayout` 中实现 `handleSendToCurrentSession`**

修改 `packages/app/src/layouts/ProjectLayout.tsx`：

1. 获取 `setInitialMessage`：

```ts
const setInitialMessage = useProjectDataStore((state) => state.setInitialMessage);
```

2. 在 `handleStartSession` 之后新增 `handleSendToCurrentSession`：

```ts
const handleSendToCurrentSession = (
  selectedText: string,
  sourcePath: string,
  comment?: string,
) => {
  if (!selectedSession) return;
  const quotedText = selectedText.split("\n").map((line) => `> ${line}`).join("\n");
  const parts = [t("text-selection.promptPrefix", { path: sourcePath, text: quotedText })];
  if (comment) parts.push(`\n\n${comment}`);
  const message = parts.join("");
  setInitialMessage(projectKey, selectedSession.id, message);
  navigate(`/project/${projectKey}/chat/${selectedSession.id}`);
};
```

注意：使用 `setInitialMessage` 将消息存入 `initialMessageBySessionId`，navigate 到聊天页面后 `Chat` 组件 mount → `useChatSession` attach → `streaming-store` 检测到 `initialMessage` → 通过 WebSocket 发送。这与 `handleStartSession` 通过 `createSession` 传入 initialMessage 的模式一致。

4. 计算 `currentSessionInfo`（在 `selectedAgent` 之后）：

```ts
const currentSessionInfo = selectedSession && selectedAgent
  ? { sessionId: selectedSession.id, agentName: selectedAgent.name }
  : null;
```

5. 透传给 `ContentBrowser`（第 145-151 行）：

```tsx
<ContentBrowser
  client={project.ctx.client}
  filePath={contentPath}
  onBack={handleBackToChat}
  agents={agents}
  currentSessionInfo={currentSessionInfo}
  onStartSession={handleStartSession}
  onSendToCurrentSession={handleSendToCurrentSession}
/>
```

- [ ] **Step 5: 验证编译通过**

```bash
npm run build --workspace=packages/app
```

---

### Task 3: 删除 Session 确认提示

**Files:**
- Modify: `packages/app/src/features/agent-session-list/index.tsx`

- [ ] **Step 1: 新增 `deleteSessionTarget` state 和确认/取消处理**

在 `AgentSessionList` 中（第 59 行 `const [deleteTarget, ...]` 之后）新增：

```ts
const [deleteSessionTarget, setDeleteSessionTarget] = useState<SessionInfo | null>(null);
```

修改 `handleDeleteSession`（第 90-96 行），改名为 `handleDeleteSessionRequest`：

```ts
const handleDeleteSessionRequest = (session: SessionInfo) => {
  setDeleteSessionTarget(session);
};
```

新增 `performDeleteSession`：

```ts
const performDeleteSession = async () => {
  if (!project || !deleteSessionTarget) return;
  const deletedId = deleteSessionTarget.id;
  setDeleteSessionTarget(null);
  await deleteSession(projectKey, project.ctx.client, deletedId);
  if (activeSessionId === deletedId) {
    navigate(`/project/${projectKey}`);
  }
};
```

- [ ] **Step 2: 渲染确认 AlertDialog**

在现有 agent 删除 AlertDialog 之后（第 208 行之后），新增：

```tsx
<AlertDialog open={!!deleteSessionTarget} onOpenChange={(open) => { if (!open) setDeleteSessionTarget(null); }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{t("session.confirmDeleteTitle")}</AlertDialogTitle>
      <AlertDialogDescription>
        {t("session.confirmDeleteDescription", {
          title: deleteSessionTarget?.title ?? t("session.untitled"),
        })}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
      <AlertDialogAction variant="destructive" onClick={performDeleteSession}>
        {t("common.delete")}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 3: 更新回调传递链**

在 `AgentSessionList` 中，将传给 `AgentSessionListView` 的 `onDeleteSession`（第 165 行）改为：

```tsx
onDeleteSession={handleDeleteSessionRequest}
```

注意：`handleDeleteSessionRequest` 接收 `SessionInfo` 而非 `string`。需要检查 `SessionRow` 的 `onDelete` 当前签名——它传递 `session.id`（`SessionRow.tsx` 第 162 行）。

需要调整传递链：
- `AgentSessionListView` 的 `onDeleteSession` 签名改为 `(session: SessionInfo) => void`
- `AgentGroup` 的 `onDeleteSession` 签名改为 `(session: SessionInfo) => void`
- `SessionRow` 的 `onDelete` 改为传递完整 session 对象而非仅 id

**`AgentSessionListView.tsx`** — `onDeleteSession: (sessionId: string) => void` 改为 `onDeleteSession: (session: SessionInfo) => void`

**`AgentGroup.tsx`** — `onDeleteSession: (sessionId: string) => void` 改为 `onDeleteSession: (session: SessionInfo) => void`，透传给 `SessionRow`

**`SessionRow.tsx`** — `onDelete: (sessionId: string) => void` 改为 `onDelete: (session: SessionInfo) => void`，第 162 行改为 `onClick={() => onDelete(session)}`

- [ ] **Step 4: 验证编译通过**

```bash
npm run build --workspace=packages/app
```

---

### Task 4: 选中 Session 对应 Agent 行高亮

**Files:**
- Modify: `packages/app/src/features/agent-session-list/AgentGroup.tsx`
- Modify: `packages/app/src/features/agent-session-list/AgentRow.tsx`

- [ ] **Step 1: `AgentGroup` 计算 `isActive` 并传给 `AgentRow`**

在 `AgentGroup.tsx` 中，计算是否有 active session 属于当前 agent：

```ts
const isActive = activeSessionId !== null && sessions.some((s) => s.id === activeSessionId);
```

传给 `AgentRow`：

```tsx
<AgentRow
  agent={agent}
  active={isActive}
  onNewSession={onNewSession}
  onEditAgent={onEditAgent}
  onDeleteAgent={onDeleteAgent}
/>
```

- [ ] **Step 2: `AgentRow` 接收 `active` prop 并添加高亮**

修改 `AgentRowProps`：

```ts
interface AgentRowProps {
  agent: AgentProfile;
  active?: boolean;
  onNewSession: (agent: AgentProfile) => void;
  onEditAgent: (agent: AgentProfile) => void;
  onDeleteAgent: (agent: AgentProfile) => void;
}
```

修改 `TreeRow` 的 `className`（第 30 行），在 `group pr-8` 之后条件添加 `bg-sidebar-accent`：

```tsx
<CollapsibleTrigger render={<TreeRow depth={0} className={cn("group pr-8", active && "bg-sidebar-accent")} />}>
```

需要导入 `cn`：

```ts
import { cn } from "@/lib/utils";
```

注意：使用 `bg-sidebar-accent`（与 TreeRow selected 状态一致，见 `tree-row.tsx` 第 18 行）。

- [ ] **Step 3: 验证编译通过**

```bash
npm run build --workspace=packages/app
```

---

### Task 5: Agent 列表默认全部折叠 + i18n 文案

**Files:**
- Modify: `packages/app/src/features/agent-session-list/index.tsx`
- Modify: `packages/i18n/src/locales/zh-CN.ts`
- Modify: `packages/i18n/src/locales/zh-TW.ts`
- Modify: `packages/i18n/src/locales/en.ts`

- [ ] **Step 1: 修改初始化逻辑**

在 `AgentSessionList` 的 `useEffect` 中（第 65-76 行），将第 68 行：

```ts
? agents.slice(1).map((agent) => agent.id)
```

改为：

```ts
? agents.map((agent) => agent.id)
```

- [ ] **Step 2: 新增 i18n 文案**

在 `zh-CN.ts` 的 `text-selection.startSession` 之后新增：

```ts
"text-selection.copy": "复制",
"text-selection.sendToCurrentSession": "发送至当前会话",
"text-selection.noActiveSession": "无活动会话",
```

在 `agent-session-list` 相关文案之后新增：

```ts
"session.confirmDeleteTitle": "删除会话？",
"session.confirmDeleteDescription": "确定要删除会话「{title}」吗？此操作无法撤销。",
"session.untitled": "无标题会话",
```

在 `zh-TW.ts` 和 `en.ts` 中添加对应翻译。

**en.ts 英文翻译：**

```ts
"text-selection.copy": "Copy",
"text-selection.sendToCurrentSession": "Send to current session",
"text-selection.noActiveSession": "No active session",
"session.confirmDeleteTitle": "Delete session?",
"session.confirmDeleteDescription": "Are you sure you want to delete session \"{title}\"? This action cannot be undone.",
"session.untitled": "Untitled session",
```

**zh-TW.ts 繁体翻译：**

```ts
"text-selection.copy": "複製",
"text-selection.sendToCurrentSession": "發送至當前會話",
"text-selection.noActiveSession": "無活動會話",
"session.confirmDeleteTitle": "刪除會話？",
"session.confirmDeleteDescription": "確定要刪除會話「{title}」嗎？此操作無法撤銷。",
"session.untitled": "無標題會話",
```

- [ ] **Step 3: 验证 i18n 和编译**

```bash
npm test --workspace=packages/i18n && npm run build --workspace=packages/app
```

---

## 验证

所有 Task 完成后，运行全量验证：

```bash
npm run lint && npm run build && npm test --workspace=packages/i18n
```

如果影响 text-selection 或 session 相关 E2E，选择性运行：

```bash
npm run test:e2e --workspace=packages/app -- e2e/text-selection-session.spec.ts
```
