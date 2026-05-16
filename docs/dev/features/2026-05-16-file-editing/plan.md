# 文件编辑功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ContentBrowser 中为 Markdown 和纯文本文件添加轻量编辑能力（查看/编辑切换、手动保存、冲突提示、离开确认）。

**Architecture:** Server 层新增 `PUT /api/content/*` 路由写入文件；前端 ApiClient 新增 `saveContent()` 方法；ContentBrowser 组件扩展编辑模式（原生 textarea）、dirty 状态管理、Ctrl/Cmd+S 保存、外部变更冲突提示、离开确认弹窗。不改动 core 层。

**Tech Stack:** Fastify（server route）、React hooks（前端状态管理）、原生 `<textarea>`（编辑器）、WebSocket fs-watch（冲突检测）

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/server/src/routes/content.ts` | 新增 `PUT /api/content/*` 路由 |
| Modify | `packages/app/src/lib/api.ts` | 新增 `saveContent()` 方法 |
| Modify | `packages/app/src/pages/ContentBrowser.tsx` | 编辑模式、保存、冲突检测、离开确认 |

---

### Task 1: Server — 新增 PUT /api/content/* 路由

**Files:**
- Modify: `packages/server/src/routes/content.ts`

- [ ] **Step 1: 在 content.ts 中新增 PUT 路由**

在 `registerContentRoutes` 函数内，紧跟现有 GET 路由之后，添加 PUT 路由：

```typescript
fastify.put<{ Params: { "*": string }; Body: { content: string } }>(
  "/api/content/*",
  async (req, reply) => {
    const relativePath = req.params["*"];
    const absolutePath = path.resolve(
      ctx.projectStore.getRootPath(),
      relativePath,
    );

    if (!absolutePath.startsWith(ctx.projectStore.getRootPath())) {
      return reply.code(403).send({ error: "Access denied" });
    }

    if (typeof req.body?.content !== "string") {
      return reply.code(400).send({ error: "Missing or invalid 'content'" });
    }

    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, req.body.content, "utf-8");
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: `Write failed: ${(err as Error).message}` });
    }
  },
);
```

- [ ] **Step 2: 编译验证**

Run: `npm run build --workspace=packages/server`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/content.ts
git commit -m "feat: add PUT /api/content/* route for file editing"
```

---

### Task 2: ApiClient — 新增 saveContent 方法

**Files:**
- Modify: `packages/app/src/lib/api.ts`

- [ ] **Step 1: 在 api.ts 中新增 saveContent 方法**

在 `getContent` 方法之后、`createAgent` 方法之前，添加：

```typescript
async saveContent(filePath: string, content: string): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${baseUrl}/api/content/${encodeURIComponent(filePath)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(err.error ?? "request failed");
  }
  return res.json();
},
```

- [ ] **Step 2: 编译验证**

Run: `npm run build --workspace=packages/app`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/lib/api.ts
git commit -m "feat: add saveContent method to ApiClient"
```

---

### Task 3: ContentBrowser — 添加编辑模式基础设施

**Files:**
- Modify: `packages/app/src/pages/ContentBrowser.tsx`

这一步搭建编辑模式的状态和 UI 切换框架，后续 Task 再添加保存、冲突、离开确认。

- [ ] **Step 1: 重写 ContentBrowser 组件，添加编辑模式状态和工具栏**

将整个 `ContentBrowser.tsx` 替换为以下内容：

```typescript
import { useState, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApiClient } from "../lib/api";

interface ContentBrowserProps {
  client: ApiClient;
  filePath: string;
  onBack: () => void;
}

export function ContentBrowser({ client, filePath, onBack }: ContentBrowserProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlView, setHtmlView] = useState<"preview" | "source">("preview");

  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const isMarkdown =
    filePath.endsWith(".md") ||
    filePath.endsWith(".markdown") ||
    filePath.endsWith(".agents.md");
  const isHtml = filePath.endsWith(".html") || filePath.endsWith(".htm");
  const isEditable = !isHtml;
  const isDirty = isEditing && editedContent !== (content ?? "");

  useEffect(() => {
    setIsEditing(false);
    setConflict(false);
    setSaveError(null);
    setShowLeaveConfirm(false);
    setLoading(true);
    setError(null);
    client
      .getContent(filePath)
      .then((data) => {
        if (data) {
          setContent(data.content);
        } else {
          setError("File not found");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filePath, client]);

  const handleEnterEdit = () => {
    setEditedContent(content ?? "");
    setSaveError(null);
    setConflict(false);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSaveError(null);
    setConflict(false);
  };

  const handleBackClick = () => {
    if (isDirty) {
      setShowLeaveConfirm(true);
    } else {
      onBack();
    }
  };

  const handleConfirmLeave = () => {
    setShowLeaveConfirm(false);
    setIsEditing(false);
    onBack();
  };

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await client.saveContent(filePath, editedContent);
      setContent(editedContent);
      setIsEditing(false);
      setConflict(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [client, filePath, editedContent, isDirty, saving]);

  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEditing, handleSave]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-surface">
        <button
          className="px-3 py-1 bg-[var(--muted-bg)] rounded text-sm text-[var(--primary)] hover:bg-[var(--hover-strong)]"
          onClick={handleBackClick}
        >
          ← 返回
        </button>
        <span className="text-sm text-[var(--secondary)] font-mono flex-1">
          {isDirty && <span className="text-[var(--accent)] mr-1">●</span>}
          {filePath}
        </span>
        {isEditing ? (
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 text-xs bg-[var(--muted-bg)] text-[var(--secondary)] rounded hover:bg-[var(--hover-strong)]"
              onClick={handleCancelEdit}
            >
              取消
            </button>
            <button
              className={`px-3 py-1 text-xs rounded ${
                isDirty && !saving
                  ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                  : "bg-[var(--muted-bg)] text-[var(--muted)] cursor-not-allowed"
              }`}
              onClick={handleSave}
              disabled={!isDirty || saving}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        ) : isEditable && !isHtml ? (
          <button
            className="px-3 py-1 text-xs bg-[var(--muted-bg)] text-[var(--secondary)] rounded hover:bg-[var(--hover-strong)]"
            onClick={handleEnterEdit}
          >
            编辑
          </button>
        ) : null}
        {isHtml && !isEditing && (
          <div className="flex rounded overflow-hidden border border-[var(--border)]">
            <button
              className={`px-3 py-1 text-xs ${htmlView === "preview" ? "bg-[var(--active-bg)] text-[var(--primary)]" : "bg-[var(--muted-bg)] text-[var(--secondary)] hover:bg-[var(--hover-strong)]"}`}
              onClick={() => setHtmlView("preview")}
            >
              预览
            </button>
            <button
              className={`px-3 py-1 text-xs border-l border-[var(--border)] ${htmlView === "source" ? "bg-[var(--active-bg)] text-[var(--primary)]" : "bg-[var(--muted-bg)] text-[var(--secondary)] hover:bg-[var(--hover-strong)]"}`}
              onClick={() => setHtmlView("source")}
            >
              源码
            </button>
          </div>
        )}
      </div>
      {conflict && isEditing && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm">
          <span className="flex-1">文件已被外部修改</span>
          <button
            className="px-2 py-0.5 text-xs rounded border border-amber-300 hover:bg-amber-100"
            onClick={() => setConflict(false)}
          >
            保留我的修改
          </button>
          <button
            className="px-2 py-0.5 text-xs rounded border border-amber-300 hover:bg-amber-100"
            onClick={async () => {
              const data = await client.getContent(filePath);
              if (data) {
                setContent(data.content);
                setEditedContent(data.content);
              }
              setConflict(false);
            }}
          >
            重新加载文件
          </button>
        </div>
      )}
      {saveError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-[var(--danger)] text-sm">
          保存失败: {saveError}
        </div>
      )}
      {isHtml && htmlView === "preview" && !isEditing && !loading && !error ? (
        <iframe
          src={client.getPreviewUrl(filePath)}
          className="flex-1 w-full border-0"
          title="HTML Preview"
        />
      ) : isEditing ? (
        <textarea
          className="flex-1 p-4 font-mono text-sm leading-relaxed resize-none bg-surface border-none outline-none"
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-[var(--muted)] text-center p-8">加载中...</p>}
          {error && <p className="text-[var(--danger)] text-center p-8">{error}</p>}
          {content && !loading && (
            isMarkdown ? (
              <div className="bg-surface p-6 rounded-lg border border-[var(--border)] leading-relaxed prose-content">
                <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
              </div>
            ) : (
              <pre className="bg-surface p-4 rounded-lg border border-[var(--border)] font-mono text-sm whitespace-pre-wrap leading-relaxed">{content}</pre>
            )
          )}
        </div>
      )}
      {showLeaveConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "var(--overlay)" }}>
          <div className="bg-surface rounded-lg shadow-lg p-6 max-w-sm w-full border border-[var(--border)]">
            <p className="text-[var(--primary)] mb-4">有未保存的修改，确定离开？</p>
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm bg-[var(--muted-bg)] rounded hover:bg-[var(--hover-strong)] text-[var(--secondary)]"
                onClick={() => setShowLeaveConfirm(false)}
              >
                继续编辑
              </button>
              <button
                className="px-4 py-2 text-sm bg-[var(--danger)] text-white rounded hover:bg-[var(--danger-hover)]"
                onClick={handleConfirmLeave}
              >
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 编译验证**

Run: `npm run build --workspace=packages/app`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/pages/ContentBrowser.tsx
git commit -m "feat: add edit mode to ContentBrowser with save, conflict, and leave confirm"
```

---

### Task 4: ContentBrowser — fs-watch 冲突检测

**Files:**
- Modify: `packages/app/src/pages/ContentBrowser.tsx`

当前 ContentBrowser 不监听 fs-watch。需要在编辑模式下监听文件变更，触发冲突提示。

- [ ] **Step 1: 添加 fs-watch 监听逻辑**

在 ContentBrowser 组件中，在 `useEffect` 键盘快捷键之后，添加新的 useEffect：

```typescript
useEffect(() => {
  if (!isEditing) return;
  const ws = client.createFsWatchWebSocket(() => {
    setConflict(true);
  });
  return () => ws.close();
}, [isEditing, client]);
```

这段代码在编辑模式下建立 fs-watch WebSocket 连接，收到任何文件变更事件时设置 `conflict = true`。退出编辑模式时自动关闭连接。

- [ ] **Step 2: 编译验证**

Run: `npm run build --workspace=packages/app`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/pages/ContentBrowser.tsx
git commit -m "feat: add fs-watch conflict detection in edit mode"
```

---

### Task 5: 端到端验证

- [ ] **Step 1: 编译所有包**

Run: `npm run build`
Expected: 所有三个包编译成功

- [ ] **Step 2: 运行 core 测试确认无回归**

Run: `npm test --workspace=packages/core`
Expected: 所有测试通过

- [ ] **Step 3: 手动验证（开发模式）**

Run: `npm run dev`
Expected: 应用启动，点击文件进入 ContentBrowser，Markdown/文本文件显示"编辑"按钮，点击进入编辑模式，Ctrl+S 保存，编辑时外部修改触发冲突提示
