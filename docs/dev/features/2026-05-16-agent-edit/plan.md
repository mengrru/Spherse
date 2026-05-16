# Agent 编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持编辑已有 agent 定义文件，在 Agent 列表菜单中添加编辑入口，复用创建对话框。

**Architecture:** core 层新增 `getRawContent(id)` 读取原始 markdown；server 层新增 `GET /api/agents/:id/raw` 和 `PUT /api/agents/:id`；前端将 `CreateAgentDialog` 改为通用 `AgentDialog` 支持创建/编辑双模式。

**Tech Stack:** TypeScript, Fastify, React, gray-matter

---

### Task 1: Core — 添加 `getRawContent` 方法

**Files:**
- Modify: `packages/core/src/store/agent-profile.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/__tests__/store/agent-profile.test.ts`

- [ ] **Step 1: 写失败测试**

在 `agent-profile.test.ts` 末尾 `describe` 块内追加：

```typescript
  it("getRawContent returns raw markdown for existing profile", async () => {
    const profile = await store.save("raw-test.md", VALID_PROFILE);
    const raw = await store.getRawContent(profile.id);
    expect(raw).toContain("name: World Builder");
    expect(raw).toContain("world building assistant");
  });

  it("getRawContent returns null for non-existent id", async () => {
    const raw = await store.getRawContent("nope");
    expect(raw).toBeNull();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test --workspace=packages/core -- --run`
Expected: 2 tests FAIL with "store.getRawContent is not a function"

- [ ] **Step 3: 在 AgentProfileStore 中实现 getRawContent**

在 `agent-profile.ts` 的 `delete` 方法后添加：

```typescript
  async getRawContent(id: string): Promise<string | null> {
    const profiles = await this.list();
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return null;
    return fs.readFile(profile.filePath, "utf-8");
  }
```

- [ ] **Step 4: 在 Engine 中暴露 getRawContent**

在 `engine.ts` 的 `deleteProfile` 方法前添加：

```typescript
  async getRawContent(id: string): Promise<string | null> {
    return this.profileStore.getRawContent(id);
  }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test --workspace=packages/core -- --run`
Expected: ALL PASS

---

### Task 2: Server — 添加 GET raw 和 PUT 路由

**Files:**
- Modify: `packages/server/src/routes/agents.ts`
- Modify: `packages/server/src/routes/agent-write.ts`

- [ ] **Step 1: 在 agents.ts 中添加 GET /api/agents/:id/raw 路由**

在 `registerAgentRoutes` 函数中 `GET /api/agents/:id` 路由之后追加：

```typescript
  fastify.get<{ Params: { id: string } }>(
    "/api/agents/:id/raw",
    async (req, reply) => {
      const raw = await ctx.engine.getRawContent(req.params.id);
      if (raw === null) return reply.code(404).send({ error: "Agent not found" });
      return { content: raw };
    },
  );
```

- [ ] **Step 2: 在 agent-write.ts 中添加 PUT /api/agents/:id 路由**

在 `registerAgentWriteRoutes` 函数中 `DELETE` 路由之前追加：

```typescript
  fastify.put<{ Params: { id: string }; Body: { content?: string } }>(
    "/api/agents/:id",
    async (req, reply) => {
      const { content } = req.body ?? {};
      if (!content)
        return reply.code(400).send({ error: "content is required" });

      const profile = await ctx.engine.getProfile(req.params.id);
      if (!profile)
        return reply.code(404).send({ error: "Agent not found" });

      const filename = path.basename(profile.filePath);
      try {
        const updated = await ctx.engine.saveProfile(filename, content);
        return { ok: true, id: updated.id };
      } catch (err: any) {
        return reply.code(500).send({ error: err.message });
      }
    },
  );
```

需要在 `agent-write.ts` 顶部添加 `import path from "node:path";`。

- [ ] **Step 3: 运行 build 确认编译通过**

Run: `npm run build --workspace=packages/server`
Expected: 编译成功无错误

---

### Task 3: Frontend API — 添加 updateAgent 和 getAgentRaw

**Files:**
- Modify: `packages/app/src/lib/api.ts`

- [ ] **Step 1: 在 api.ts 中添加两个方法**

在 `deleteAgent` 方法之前追加：

```typescript
    async getAgentRaw(id: string): Promise<string> {
      const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(id)}/raw`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      const data = await res.json();
      return data.content;
    },

    async updateAgent(id: string, content: string): Promise<{ ok: boolean; id: string }> {
      const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },
```

---

### Task 4: Frontend UI — 改造 CreateAgentDialog 为 AgentDialog

**Files:**
- Rename: `packages/app/src/components/CreateAgentDialog.tsx` → `packages/app/src/components/AgentDialog.tsx`
- Modify: `packages/app/src/pages/ProjectPage.tsx`（更新 import）

- [ ] **Step 1: 重命名文件并修改组件**

将 `CreateAgentDialog.tsx` 重命名为 `AgentDialog.tsx`，内容替换为：

```typescript
import { useState } from "react";

const AGENT_TEMPLATE = `---
name: 新 Agent
model: gemini-2.5-pro
type: creator
tools:
  - read_file
  - write_file
  - edit_file
  - list_files
  - search_content
  - append_changelog
context: []
---

# 系统提示

你是一个世界观创作助手。

## 创作风格

- 保持与已有设定的一致性
`;

interface AgentDialogProps {
  mode: "create" | "edit";
  initialContent?: string;
  onSubmit: (filename: string, content: string) => Promise<void>;
  onCancel: () => void;
}

export function AgentDialog({ mode, initialContent, onSubmit, onCancel }: AgentDialogProps) {
  const [content, setContent] = useState(initialContent ?? AGENT_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractFilename = (): string | null => {
    const match = content.match(/^name:\s*(.+)$/m);
    if (!match) return null;
    const name = match[1].trim();
    return `${name}.md`;
  };

  const handleSubmit = async () => {
    const filename = extractFilename();
    if (!filename) {
      setError("模板中缺少 name 字段");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(filename, content);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[var(--overlay)] flex items-center justify-center z-[100]" onClick={onCancel}>
      <div className="bg-surface rounded-[10px] w-[600px] max-h-[80vh] flex flex-col shadow-[var(--shadow-dialog)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-light)]">
          <h2 className="text-base font-semibold text-[var(--primary)]">
            {mode === "create" ? "创建 Agent" : "编辑 Agent"}
          </h2>
          <button className="bg-none text-lg text-[var(--muted)] p-1 hover:text-[var(--primary)]" onClick={onCancel}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-[var(--muted)] mb-3">
            编辑 frontmatter（name/model/type/tools/context）和正文（系统提示）。
            文件名取自 <code className="bg-[var(--code-bg)] px-1 py-[1px] rounded text-[11px]">name</code> 字段。
          </p>
          <textarea
            className="w-full min-h-[320px] p-3 border border-[var(--border-input)] rounded-md font-mono text-[13px] leading-relaxed resize-y outline-none tab-[2] bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
          {error && <p className="text-danger text-xs mt-2">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-light)]">
          <button className="px-4 py-1.5 bg-[var(--muted-bg)] rounded-[5px] text-[13px] text-[var(--on-muted)] hover:bg-[var(--border)]" onClick={onCancel}>
            取消
          </button>
          <button
            className="px-4 py-1.5 bg-accent text-white rounded-[5px] text-[13px] hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "保存中..." : mode === "create" ? "创建" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 更新 ProjectPage 中的 import**

在 `ProjectPage.tsx` 中，将：

```typescript
import { CreateAgentDialog } from "../components/CreateAgentDialog";
```

改为：

```typescript
import { AgentDialog } from "../components/AgentDialog";
```

- [ ] **Step 3: 删除旧文件**

Run: `rm packages/app/src/components/CreateAgentDialog.tsx`

---

### Task 5: Frontend UI — ProjectPage 集成编辑功能

**Files:**
- Modify: `packages/app/src/pages/ProjectPage.tsx`

- [ ] **Step 1: 添加编辑状态变量**

在 `ProjectPage.tsx` 的 state 声明区域，`showCreateAgent` 之后追加：

```typescript
  const [editAgent, setEditAgent] = useState<{ id: string; content: string } | null>(null);
```

- [ ] **Step 2: 添加 handleEditAgent 处理函数**

在 `handleCreateAgent` 函数之后追加：

```typescript
  const handleEditAgent = async (agent: AgentProfile) => {
    setMenuAgentId(null);
    const raw = await ctx.client.getAgentRaw(agent.id);
    setEditAgent({ id: agent.id, content: raw });
  };

  const handleEditSubmit = async (_filename: string, content: string) => {
    if (!editAgent) return;
    await ctx.client.updateAgent(editAgent.id, content);
    setEditAgent(null);
    refreshAgents();
  };
```

- [ ] **Step 3: 在 Agent 菜单中添加"编辑"选项**

在 `ProjectPage.tsx` 的 Agent 菜单 `div`（`ref={agentMenuRef}`）中，"新建对话"按钮之后追加：

```typescript
                        <button
                          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-[var(--hover)] transition-colors"
                          onClick={() => handleEditAgent(agent)}
                        >
                          编辑
                        </button>
```

- [ ] **Step 4: 替换 CreateAgentDialog 为 AgentDialog**

将渲染 `CreateAgentDialog` 的部分（`{showCreateAgent && ...}`）替换为两段：

```typescript
      {showCreateAgent && (
        <AgentDialog
          mode="create"
          onSubmit={handleCreateAgent}
          onCancel={() => setShowCreateAgent(false)}
        />
      )}
      {editAgent && (
        <AgentDialog
          mode="edit"
          initialContent={editAgent.content}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditAgent(null)}
        />
      )}
```

- [ ] **Step 5: 运行 build 确认编译通过**

Run: `npm run build`
Expected: 所有 package 编译成功无错误

---

### Task 6: 验证与清理

- [ ] **Step 1: 运行 core 测试**

Run: `npm test --workspace=packages/core -- --run`
Expected: ALL PASS

- [ ] **Step 2: 全量 build**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: 更新 backlog**

将 `docs/dev/backlog.md` 中 `Agent 编辑` 条目状态改为 `[x]`。
