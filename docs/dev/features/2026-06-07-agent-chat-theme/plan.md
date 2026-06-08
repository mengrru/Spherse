# Agent 聊天窗口主题自定义 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持 agent 级聊天窗口主题自定义，用户可在 Agent Dialog 编辑 theme.css，聊天窗口加载时注入 scoped 样式。

**Architecture:** theme.css 作为独立文件存储在 agent 目录下。聊天组件 mount 时通过 API 读取 CSS，用 `<style>` 标签注入到 `[data-chat-root]` 容器内，通过选择器前缀限定作用域。Agent Dialog 改为双标签页结构。

**Tech Stack:** TypeScript, React, Fastify, Vitest, Tailwind CSS v4, @base-ui/react Tabs

**Design doc:** `docs/dev/features/2026-06-07-agent-chat-theme/design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `packages/presets/templates/agent-theme-template.css` | 带注释的默认主题模板 |
| `packages/presets/src/generated/agent-theme-template.ts` | 由 sync-templates 脚本生成，导出 `AGENT_THEME_TEMPLATE` 字符串常量 |
| `packages/app/src/features/chat/hooks/useAgentTheme.ts` | Hook：读取 agent theme.css 并返回 scoped CSS |

### Modified files

| File | Change |
|------|--------|
| `packages/presets/scripts/sync-templates.mjs` | 添加 agent-theme-template.css 到 mapping |
| `packages/presets/src/index.ts` | 导出 `AGENT_THEME_TEMPLATE` |
| `packages/core/src/store/agent-profile.ts` | 新增 `getTheme()` / `saveTheme()` 方法 |
| `packages/core/src/engine.ts` | 新增 `getAgentTheme()` / `saveAgentTheme()` 代理方法 |
| `packages/server/src/routes/agents.ts` | 新增 `GET /api/agents/:id/theme` 端点 |
| `packages/server/src/routes/agent-write.ts` | create/update 端点支持 `themeContent` |
| `packages/app/src/lib/api.ts` | 新增 `getAgentTheme()` / 修改 `createAgent()` / `updateAgent()` |
| `packages/app/src/stores/project-data-store.ts` | `createAgent` / `updateAgent` 传递 `themeContent` |
| `packages/app/src/features/agent-session-list/index.tsx` | 传递 `themeContent` 到 agent CRUD handlers |
| `packages/app/src/components/AgentDialog.tsx` | 双标签页 + 主题编辑器 |
| `packages/app/src/features/chat/index.tsx` | 添加 `data-chat-root`，使用 `useAgentTheme` 注入 `<style>` |
| `packages/app/src/features/chat/MessageList.tsx` | 添加 `data-chat-messages` |
| `packages/app/src/features/chat/MessageItem.tsx` | 添加 `data-chat-message` + `data-role` |
| `packages/app/src/features/chat/Composer.tsx` | 添加 `data-chat-composer` |
| `packages/i18n/src/locales/zh-CN.ts` | 新增 2 key |
| `packages/i18n/src/locales/zh-TW.ts` | 新增 2 key |
| `packages/i18n/src/locales/en.ts` | 新增 2 key |
| `packages/core/src/__tests__/store/agent-profile.test.ts` | 新增 getTheme/saveTheme 测试 |

---

### Task 1: Core — AgentProfileStore getTheme/saveTheme

**Files:**
- Modify: `packages/core/src/store/agent-profile.ts`
- Modify: `packages/core/src/engine.ts`
- Test: `packages/core/src/__tests__/store/agent-profile.test.ts`

- [ ] **Step 1: Write failing tests for getTheme and saveTheme**

Add to `packages/core/src/__tests__/store/agent-profile.test.ts`, after the existing `getRawContent` tests (after line 130):

```typescript
it("getTheme returns empty string when theme.css does not exist", async () => {
  const profile = await store.save("theme-test", VALID_PROFILE);
  const theme = await store.getTheme(profile.id);
  expect(theme).toBe("");
});

it("saveTheme writes theme.css to agent directory", async () => {
  const profile = await store.save("theme-test", VALID_PROFILE);
  await store.saveTheme(profile.id, ":root { --test: red; }");
  const theme = await store.getTheme(profile.id);
  expect(theme).toBe(":root { --test: red; }");
  expect(pathExists(agentDir, `${profile.slug}/theme.css`)).toBe(true);
});

it("saveTheme overwrites existing theme.css", async () => {
  const profile = await store.save("theme-test", VALID_PROFILE);
  await store.saveTheme(profile.id, "first");
  await store.saveTheme(profile.id, "second");
  const theme = await store.getTheme(profile.id);
  expect(theme).toBe("second");
});

it("getTheme returns empty string for non-existent agent", async () => {
  const theme = await store.getTheme("nope");
  expect(theme).toBe("");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- --reporter=verbose agent-profile`
Expected: 4 new tests FAIL

- [ ] **Step 3: Implement getTheme and saveTheme in AgentProfileStore**

Add to `packages/core/src/store/agent-profile.ts`, after `getRawContent` method (after line 117):

```typescript
async getTheme(id: string): Promise<string> {
  const profiles = await this.list();
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return "";
  const themePath = path.join(path.dirname(profile.filePath), "theme.css");
  try {
    return await fs.readFile(themePath, "utf-8");
  } catch {
    return "";
  }
}

async saveTheme(id: string, content: string): Promise<void> {
  const profiles = await this.list();
  const profile = profiles.find((p) => p.id === id);
  if (!profile) throw new Error("agent not found");
  const themePath = path.join(path.dirname(profile.filePath), "theme.css");
  await fs.writeFile(themePath, content, "utf-8");
}
```

- [ ] **Step 4: Add engine proxy methods**

Add to `packages/core/src/engine.ts`, after `deleteProfile` method:

```typescript
async getAgentTheme(agentId: string): Promise<string> {
  return this.profileStore.getTheme(agentId);
}

async saveAgentTheme(agentId: string, content: string): Promise<void> {
  await this.profileStore.saveTheme(agentId, content);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- --reporter=verbose agent-profile`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store/agent-profile.ts packages/core/src/engine.ts packages/core/src/__tests__/store/agent-profile.test.ts
git commit -m "feat(core): add getTheme/saveTheme to AgentProfileStore"
```

---

### Task 2: Server — Theme API endpoints

**Files:**
- Modify: `packages/server/src/routes/agents.ts`
- Modify: `packages/server/src/routes/agent-write.ts`

- [ ] **Step 1: Add GET /api/agents/:id/theme endpoint**

In `packages/server/src/routes/agents.ts`, add after the existing `/api/agents/:id/raw` handler (after line 25):

```typescript
fastify.get<{ Params: { id: string } }>(
  "/api/agents/:id/theme",
  async (req, reply) => {
    const theme = await ctx.engine.getAgentTheme(req.params.id);
    reply.type("text/css").send(theme);
  },
);
```

- [ ] **Step 2: Extend create endpoint to accept themeContent**

In `packages/server/src/routes/agent-write.ts`, modify the create handler body type and logic:

Change line 5's type:
```typescript
fastify.post<{ Body: { slug?: string; content?: string; themeContent?: string } }>(
```

After line 18 (`const profile = await ctx.engine.saveProfile(slug, content);`), add:
```typescript
if (themeContent !== undefined) {
  await ctx.engine.saveAgentTheme(profile.id, themeContent);
}
```

And update the destructuring on line 8:
```typescript
const { slug, content, themeContent } = req.body ?? {};
```

- [ ] **Step 3: Extend update endpoint to accept themeContent**

In the same file, modify the update handler body type:

Change line 25's type:
```typescript
fastify.put<{ Params: { id: string }; Body: { content?: string; themeContent?: string } }>(
```

Update destructuring, add after line 28:
```typescript
const { content, themeContent } = req.body ?? {};
```

After the `saveProfile` call (after line 38), add:
```typescript
if (themeContent !== undefined) {
  await ctx.engine.saveAgentTheme(req.params.id, themeContent);
}
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build --workspace=packages/server`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/agents.ts packages/server/src/routes/agent-write.ts
git commit -m "feat(server): add theme API endpoints for agents"
```

---

### Task 3: Presets — Agent theme template

**Files:**
- Create: `packages/presets/templates/agent-theme-template.css`
- Modify: `packages/presets/scripts/sync-templates.mjs`
- Modify: `packages/presets/src/index.ts`

- [ ] **Step 1: Create the theme template CSS file**

Create `packages/presets/templates/agent-theme-template.css`:

```css
/* 聊天窗口主题 — 取消注释并修改下方规则来自定义外观 */
/* 保存后立即生效 */

/* === 基础颜色 === */
/* --shadcn-background: #ffffff; */
/* --shadcn-foreground: #0a0a0a; */

/* === 主色（用户消息气泡、发送按钮等） === */
/* --shadcn-primary: #171717; */
/* --shadcn-primary-foreground: #fafafa; */

/* === 卡片 / 助手消息气泡 === */
/* --shadcn-card: #ffffff; */
/* --shadcn-card-foreground: #0a0a0a; */

/* === 边框 === */
/* --shadcn-border: #e5e5e5; */

/* === 输入框背景 === */
/* --shadcn-muted: #f5f5f5; */
/* --shadcn-muted-foreground: #737373; */

/* === 聊天窗口背景图 === */
/* background-image: url('https://example.com/bg.jpg'); */
/* background-size: cover; */
/* background-position: center; */

/* === 助手消息气泡头像（使用 CSS 伪元素） === */
/* [data-chat-message][data-role="assistant"] { */
/*   position: relative; */
/* } */
/* [data-chat-message][data-role="assistant"]::before { */
/*   content: ''; */
/*   display: block; */
/*   width: 36px; */
/*   height: 36px; */
/*   border-radius: 50%; */
/*   background-image: url('https://example.com/avatar.png'); */
/*   background-size: cover; */
/*   margin-right: 8px; */
/*   flex-shrink: 0; */
/* } */

/* === 消息气泡样式 === */
/* [data-chat-message][data-role="user"] { */
/*   border-radius: 18px 18px 4px 18px; */
/* } */
/* [data-chat-message][data-role="assistant"] { */
/*   border-radius: 18px 18px 18px 4px; */
/*   box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06); */
/* } */

/* === 输入框样式 === */
/* [data-chat-composer] { */
/*   background: rgba(0, 0, 0, 0.03); */
/* } */
```

- [ ] **Step 2: Add mapping to sync-templates script**

In `packages/presets/scripts/sync-templates.mjs`, add to the `mapping` array (after line 12):

```javascript
["agent-theme-template.css", "AGENT_THEME_TEMPLATE", "agent-theme-template.ts"],
```

- [ ] **Step 3: Export from presets index**

In `packages/presets/src/index.ts`, add:

```typescript
export { AGENT_THEME_TEMPLATE } from "./generated/agent-theme-template.js";
```

- [ ] **Step 4: Build presets to generate the file**

Run: `npm run build --workspace=packages/presets`
Expected: Build succeeds, `src/generated/agent-theme-template.ts` is created

- [ ] **Step 5: Commit**

```bash
git add packages/presets/templates/agent-theme-template.css packages/presets/scripts/sync-templates.mjs packages/presets/src/index.ts packages/presets/src/generated/agent-theme-template.ts
git commit -m "feat(presets): add agent theme CSS template"
```

---

### Task 4: i18n — Add new keys

**Files:**
- Modify: `packages/i18n/src/locales/zh-CN.ts`
- Modify: `packages/i18n/src/locales/zh-TW.ts`
- Modify: `packages/i18n/src/locales/en.ts`

- [ ] **Step 1: Add keys to zh-CN.ts**

In `packages/i18n/src/locales/zh-CN.ts`, add after `"agent-dialog.saveFailed"` (after line 95):

```typescript
// Agent dialog "基本" 标签页标题
"agent-dialog.tabBasic": "基本",
// Agent dialog "主题" 标签页标题
"agent-dialog.tabTheme": "主题",
```

- [ ] **Step 2: Add keys to en.ts**

In `packages/i18n/src/locales/en.ts`, add after `"agent-dialog.saveFailed"` (after line 47):

```typescript
"agent-dialog.tabBasic": "General",
"agent-dialog.tabTheme": "Theme",
```

- [ ] **Step 3: Add keys to zh-TW.ts**

In `packages/i18n/src/locales/zh-TW.ts`, add after `"agent-dialog.saveFailed"` (after line 47):

```typescript
"agent-dialog.tabBasic": "基本",
"agent-dialog.tabTheme": "主題",
```

- [ ] **Step 4: Build i18n to verify**

Run: `npm run build --workspace=packages/i18n`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/locales/zh-CN.ts packages/i18n/src/locales/en.ts packages/i18n/src/locales/zh-TW.ts
git commit -m "feat(i18n): add agent dialog tab labels"
```

---

### Task 5: Frontend — API client & data store

**Files:**
- Modify: `packages/app/src/lib/api.ts`
- Modify: `packages/app/src/stores/project-data-store.ts`

- [ ] **Step 1: Add getAgentTheme to API client**

In `packages/app/src/lib/api.ts`, add after `getAgentRaw` method (after line 154):

```typescript
async getAgentTheme(id: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(id)}/theme`);
  if (!res.ok) return "";
  return res.text();
},
```

- [ ] **Step 2: Modify createAgent to accept themeContent**

Change the `createAgent` method signature and body (around line 133):

```typescript
async createAgent(slug: string, content: string, themeContent?: string): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`${baseUrl}/api/agents/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, content, themeContent }),
  });
```

- [ ] **Step 3: Modify updateAgent to accept themeContent**

Change the `updateAgent` method signature and body (around line 156):

```typescript
async updateAgent(id: string, content: string, themeContent?: string): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, themeContent }),
  });
```

- [ ] **Step 4: Update project-data-store createAgent**

In `packages/app/src/stores/project-data-store.ts`, update the interface (line 28):

```typescript
createAgent: (projectKey: string, client: ApiClient, slug: string, content: string, themeContent?: string) => Promise<boolean>;
```

Update the implementation (around line 202), change:
```typescript
await client.createAgent(slug, content);
```
to:
```typescript
await client.createAgent(slug, content, themeContent);
```

And update the method signature:
```typescript
async createAgent(projectKey, client, slug, content, themeContent?) {
```

- [ ] **Step 5: Update project-data-store updateAgent**

Update the interface (line 29):

```typescript
updateAgent: (projectKey: string, client: ApiClient, agentId: string, content: string, themeContent?: string) => Promise<boolean>;
```

Update the implementation (around line 221), change:
```typescript
await client.updateAgent(agentId, content);
```
to:
```typescript
await client.updateAgent(agentId, content, themeContent);
```

And update the method signature:
```typescript
async updateAgent(projectKey, client, agentId, content, themeContent?) {
```

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/lib/api.ts packages/app/src/stores/project-data-store.ts
git commit -m "feat(app): add theme support to API client and data store"
```

---

### Task 6: Frontend — Agent Dialog tabs & theme editor

**Files:**
- Modify: `packages/app/src/components/AgentDialog.tsx`

This is the largest single change. The existing single-form layout becomes a tabbed layout.

- [ ] **Step 1: Add imports and restructure AgentDialog**

In `packages/app/src/components/AgentDialog.tsx`, add imports:

```typescript
import { AGENT_THEME_TEMPLATE } from "@spherse/presets";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
```

Update `AgentDialogProps` to accept and return theme content:

```typescript
interface AgentDialogProps {
  mode: "create" | "edit";
  initialContent?: string;
  initialThemeContent?: string;
  client: ApiClient;
  onSubmit: (slug: string, content: string, themeContent: string) => Promise<void>;
  onCancel: () => void;
}
```

Add `themeContent` state inside the component, after the existing state declarations:

```typescript
const [themeContent, setThemeContent] = useState(initialThemeContent ?? AGENT_THEME_TEMPLATE);
```

Update `handleSubmit` to pass themeContent:

Change the `try` block:
```typescript
try { await onSubmit(slug, content, themeContent); }
```

- [ ] **Step 2: Wrap form content in tabs**

Replace the `<div className="min-h-0 flex-1 overflow-y-auto">` block with:

```tsx
<Tabs defaultValue="basic" className="min-h-0 flex-1 flex flex-col">
  <TabsList className="mx-4 mt-1">
    <TabsTrigger value="basic">{t("agent-dialog.tabBasic")}</TabsTrigger>
    <TabsTrigger value="theme">{t("agent-dialog.tabTheme")}</TabsTrigger>
  </TabsList>
  <TabsContent value="basic" className="overflow-y-auto px-4">
    <FieldGroup>
      <Field>
        <FieldLabel>{t("agent-dialog.nameLabel")}</FieldLabel>
        <Input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          placeholder={t("agent-dialog.namePlaceholder")}
        />
      </Field>
      <ToolPicker selectedTools={formData.tools} onToggle={toggleTool} />
      <ContextPathField
        client={client}
        contextPaths={formData.context}
        onAdd={addContext}
        onRemove={removeContext}
      />
      <Field>
        <FieldLabel>{t("agent-dialog.promptLabel")}</FieldLabel>
        <Textarea
          className="min-h-40 resize-y font-mono"
          value={formData.systemPrompt}
          onChange={(e) => setFormData((prev) => ({ ...prev, systemPrompt: e.target.value }))}
          spellCheck={false}
        />
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </FieldGroup>
  </TabsContent>
  <TabsContent value="theme" className="flex-1 min-h-0 overflow-hidden px-4">
    <Textarea
      className="h-full resize-none font-mono text-xs"
      value={themeContent}
      onChange={(e) => setThemeContent(e.target.value)}
      spellCheck={false}
    />
  </TabsContent>
</Tabs>
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build --workspace=packages/app`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/AgentDialog.tsx
git commit -m "feat(app): add theme tab to AgentDialog"
```

---

### Task 7: Frontend — Update agent-session-list to pass theme data

**Files:**
- Modify: `packages/app/src/features/agent-session-list/index.tsx`

- [ ] **Step 1: Update handlers to accept and pass themeContent**

In `packages/app/src/features/agent-session-list/index.tsx`:

Update `handleCreateAgent` (around line 120):
```typescript
const handleCreateAgent = async (slug: string, content: string, themeContent: string) => {
  if (!project) return;
  const ok = await createAgent(projectKey, project.ctx.client, slug, content, themeContent);
  if (ok) setShowCreateAgent(false);
};
```

Update `handleEditAgent` (around line 126) to also load theme:
```typescript
const handleEditAgent = async (agent: AgentProfile) => {
  if (!project) return;
  const [raw, theme] = await Promise.all([
    project.ctx.client.getAgentRaw(agent.id),
    project.ctx.client.getAgentTheme(agent.id),
  ]);
  setEditAgent({ id: agent.id, content: raw, themeContent: theme });
};
```

Update `editAgent` state type (line 58):
```typescript
const [editAgent, setEditAgent] = useState<{ id: string; content: string; themeContent: string } | null>(null);
```

Update `handleEditSubmit` (line 132):
```typescript
const handleEditSubmit = async (_slug: string, content: string, themeContent: string) => {
  if (!project || !editAgent) return;
  const ok = await updateAgent(projectKey, project.ctx.client, editAgent.id, content, themeContent);
  if (ok) setEditAgent(null);
};
```

Update the edit-mode `AgentDialog` (around line 176) to pass `initialThemeContent`:
```tsx
<AgentDialog
  mode="edit"
  initialContent={editAgent.content}
  initialThemeContent={editAgent.themeContent}
  client={project.ctx.client}
  onSubmit={handleEditSubmit}
  onCancel={() => setEditAgent(null)}
/>
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/features/agent-session-list/index.tsx
git commit -m "feat(app): pass theme content through agent CRUD flow"
```

---

### Task 8: Frontend — Chat data attributes

**Files:**
- Modify: `packages/app/src/features/chat/index.tsx`
- Modify: `packages/app/src/features/chat/MessageList.tsx`
- Modify: `packages/app/src/features/chat/MessageItem.tsx`
- Modify: `packages/app/src/features/chat/Composer.tsx`

- [ ] **Step 1: Add data-chat-root to Chat container**

In `packages/app/src/features/chat/index.tsx`, change line 26:

```tsx
<div className="flex flex-col h-full" data-chat-root>
```

- [ ] **Step 2: Add data-chat-messages to MessageList container**

In `packages/app/src/features/chat/MessageList.tsx`, change line 31:

```tsx
<div ref={containerRef} className="h-full overflow-y-auto p-4 flex flex-col gap-3" data-chat-messages>
```

- [ ] **Step 3: Add data-chat-message and data-role to MessageItem**

In `packages/app/src/features/chat/MessageItem.tsx`, change line 17:

```tsx
<div
  className={`group max-w-[80%] flex items-end gap-1.5 ${isUser ? "self-end flex-row-reverse" : "self-start"}`}
  data-chat-message
  data-role={message.role}
>
```

- [ ] **Step 4: Add data-chat-composer to Composer container**

In `packages/app/src/features/chat/Composer.tsx`, change line 85:

```tsx
<div className="border-t border-border bg-background p-3" data-chat-composer>
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/features/chat/index.tsx packages/app/src/features/chat/MessageList.tsx packages/app/src/features/chat/MessageItem.tsx packages/app/src/features/chat/Composer.tsx
git commit -m "feat(app): add data attributes to chat components for CSS targeting"
```

---

### Task 9: Frontend — useAgentTheme hook

**Files:**
- Create: `packages/app/src/features/chat/hooks/useAgentTheme.ts`
- Modify: `packages/app/src/features/chat/index.tsx`

- [ ] **Step 1: Create useAgentTheme hook**

Create `packages/app/src/features/chat/hooks/useAgentTheme.ts`:

```typescript
import { useState, useEffect } from "react";
import type { ApiClient } from "../../../lib/api";

function scopeCss(css: string): string {
  const SCOPE = "[data-chat-root]";
  const lines = css.split("\n");
  const result: string[] = [];
  let inBlock = 0;
  let buffer = "";

  for (const line of lines) {
    for (const ch of line) {
      if (ch === "{") {
        inBlock++;
      } else if (ch === "}") {
        inBlock--;
      }
    }

    buffer += line + "\n";

    if (inBlock === 0 && buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("@")) {
        result.push(trimmed);
      } else if (trimmed.startsWith("--") || /^[a-z-]+\s*:/.test(trimmed)) {
        result.push(`${SCOPE} { ${trimmed} }`);
      } else {
        const scoped = trimmed.replace(
          /^([^@{}/]+?)(\s*\{)/gm,
          (_, selectors, brace) => {
            const prefixed = selectors
              .split(",")
              .map((s: string) => `${SCOPE} ${s.trim()}`)
              .join(", ");
            return `${prefixed}${brace}`;
          },
        );
        result.push(scoped);
      }
      buffer = "";
    }
  }

  if (buffer.trim()) {
    result.push(`${SCOPE} { ${buffer.trim()} }`);
  }

  return result.join("\n\n");
}

export function useAgentTheme(client: ApiClient | undefined, agentId: string | undefined) {
  const [scopedCss, setScopedCss] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !agentId) return;

    let cancelled = false;
    client.getAgentTheme(agentId).then((css) => {
      if (cancelled) return;
      if (css.trim()) {
        setScopedCss(scopeCss(css));
      } else {
        setScopedCss(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, agentId]);

  return scopedCss;
}
```

- [ ] **Step 2: Use the hook in Chat component**

In `packages/app/src/features/chat/index.tsx`, add import:

```typescript
import { useAgentTheme } from "./hooks/useAgentTheme";
```

Inside the `Chat` function, add after existing hooks:

```typescript
const scopedThemeCss = useAgentTheme(client, agent.id);
```

In the JSX, add the `<style>` tag as the first child of the `<div data-chat-root>` container:

```tsx
<div className="flex flex-col h-full" data-chat-root>
  {scopedThemeCss && <style>{scopedThemeCss}</style>}
  <Header agent={agent} />
  ...
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build --workspace=packages/app`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/features/chat/hooks/useAgentTheme.ts packages/app/src/features/chat/index.tsx
git commit -m "feat(app): add useAgentTheme hook and inject scoped styles into chat"
```

---

### Task 10: Verification

- [ ] **Step 1: Run full lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 2: Run core tests**

Run: `npm test --workspace=packages/core`
Expected: All tests pass

- [ ] **Step 3: Run i18n tests**

Run: `npm test --workspace=packages/i18n`
Expected: All tests pass

- [ ] **Step 4: Run app tests**

Run: `npm test --workspace=packages/app`
Expected: All tests pass

- [ ] **Step 5: Build all packages**

Run: `npm run build`
Expected: All packages build successfully
