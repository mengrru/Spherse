# Tool Call Path 可点击跳转 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 chat 界面的 tool call 展开区域中，将 `path` / `file_path` 参数渲染为可点击链接，点击后跳转到 ContentBrowser 查看对应文件。

**Architecture:** 采用回调透传方案：`onNavigateToPath` 回调从 ProjectPage → ChatPage → ToolCallSection 逐层传递。ToolCallSection 在展开状态下检测 `path`/`file_path` 参数，渲染为可点击链接。

**Tech Stack:** React (TypeScript), Tailwind CSS v4

---

### Task 1: ToolCallSection 添加路径链接渲染

**Files:**
- Modify: `packages/app/src/components/ToolCallSection.tsx`

- [ ] **Step 1: 给 ToolCallSectionProps 添加 onNavigateToPath 回调**

在 `ToolCallSection.tsx` 的 Props 接口中新增可选回调：

```tsx
interface ToolCallSectionProps {
  toolCalls: ToolCallInfo[];
  onNavigateToPath?: (path: string) => void;
}
```

更新组件签名：

```tsx
export function ToolCallSection({ toolCalls, onNavigateToPath }: ToolCallSectionProps) {
```

- [ ] **Step 2: 修改展开区域的参数值渲染，为 path/file_path 添加链接**

将展开区域中的 `<td>` 参数值列（约第 76-79 行）替换为条件渲染逻辑：当 key 为 `path` 或 `file_path`、值为字符串、且 `onNavigateToPath` 存在时，渲染为可点击按钮；否则保持原样。

替换：

```tsx
<td className="py-0.5">
  <code className="bg-[var(--code-bg)] px-1 py-[1px] rounded-[2px] break-all whitespace-pre-wrap">
    {formatArgValue(value)}
  </code>
</td>
```

为：

```tsx
<td className="py-0.5">
  {(key === "path" || key === "file_path") && typeof value === "string" && onNavigateToPath ? (
    <button
      className="text-[var(--accent)] underline decoration-[var(--accent)] hover:opacity-80 text-left break-all whitespace-pre-wrap font-mono text-xs bg-transparent border-none p-0 cursor-pointer"
      onClick={() => onNavigateToPath(value)}
    >
      {value}
    </button>
  ) : (
    <code className="bg-[var(--code-bg)] px-1 py-[1px] rounded-[2px] break-all whitespace-pre-wrap">
      {formatArgValue(value)}
    </code>
  )}
</td>
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit -p packages/app/tsconfig.json`
Expected: 无类型错误

---

### Task 2: ChatPage 透传 onNavigateToPath

**Files:**
- Modify: `packages/app/src/pages/ChatPage.tsx`

- [ ] **Step 1: 给 ChatPageProps 添加 onNavigateToPath**

在 `ChatPage.tsx` 的 Props 接口中新增：

```tsx
interface ChatPageProps {
  client: ApiClient;
  sessionId: string;
  agent: AgentProfile;
  onNavigateToPath?: (path: string) => void;
}
```

更新组件签名：

```tsx
export function ChatPage({ client, sessionId, agent, onNavigateToPath }: ChatPageProps) {
```

- [ ] **Step 2: 传递 onNavigateToPath 给 ToolCallSection**

找到 ChatPage 中使用 ToolCallSection 的地方（约第 314 行），将：

```tsx
<ToolCallSection toolCalls={msg._toolCalls} />
```

改为：

```tsx
<ToolCallSection toolCalls={msg._toolCalls} onNavigateToPath={onNavigateToPath} />
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit -p packages/app/tsconfig.json`
Expected: 无类型错误

---

### Task 3: ProjectPage 传入 handleSelectFile

**Files:**
- Modify: `packages/app/src/pages/ProjectPage.tsx`

- [ ] **Step 1: 给 ChatPage 传入 onNavigateToPath**

找到 ProjectPage 中渲染 ChatPage 的地方（约第 287 行），将：

```tsx
<ChatPage client={ctx.client} sessionId={selectedSession.id} agent={selectedAgent} />
```

改为：

```tsx
<ChatPage client={ctx.client} sessionId={selectedSession.id} agent={selectedAgent} onNavigateToPath={handleSelectFile} />
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit -p packages/app/tsconfig.json`
Expected: 无类型错误

---

### Task 4: 端到端验证

- [ ] **Step 1: 启动开发环境，编译所有包**

Run: `npm run build`

- [ ] **Step 2: 启动桌面应用进行手动测试**

Run: `npm run dev`

验证场景：
1. 打开一个已有对话，找到包含 `read_file` / `write_file` / `edit_file` 等工具调用的消息
2. 展开工具调用，确认 `path` 参数显示为带下划线的可点击链接
3. 点击 path 链接，确认跳转到 ContentBrowser 并显示对应文件内容
4. 点击 ContentBrowser 的返回按钮，确认回到 chat 视图
5. 确认非 path 参数（如 `content`、`query`）仍为普通代码样式，不可点击
6. 确认折叠状态下摘要行无变化
