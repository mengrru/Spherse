# Agent 编辑 UI 增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AgentDialog 从 raw Markdown textarea 改为结构化表单（名称、工具权限、参考资料、提示词），前端做 Markdown ↔ 表单双向转换。

**Architecture:** 新增 `agent-markdown.ts`（Markdown 解析/构建）和 `tool-registry.ts`（工具映射），重写 `AgentDialog.tsx` 为表单式 UI。后端 API 不变。

**Tech Stack:** React, js-yaml, Tailwind CSS v4, 现有 ApiClient

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/app/src/lib/tool-registry.ts` | Create | 工具 ID ↔ 显示名映射 |
| `packages/app/src/lib/agent-markdown.ts` | Create | Markdown ↔ 表单数据双向转换 |
| `packages/app/src/components/AgentDialog.tsx` | Modify | 重写为表单式 UI |
| `packages/app/package.json` | Modify | 新增 js-yaml 依赖 |

---

### Task 1: 安装 js-yaml 依赖

**Files:**
- Modify: `packages/app/package.json`

- [ ] **Step 1: 安装 js-yaml 和类型**

```bash
npm install js-yaml --save --workspace=packages/app && npm install @types/js-yaml --save-dev --workspace=packages/app
```

- [ ] **Step 2: 验证安装**

```bash
node -e "require('js-yaml')" --input-type=module -e "import yaml from 'js-yaml'; console.log('ok')"
```

Expected: 无报错

- [ ] **Step 3: Commit**

```bash
git add packages/app/package.json packages/app/package-lock.json
git commit -m "chore: add js-yaml dependency to app package"
```

---

### Task 2: 创建工具注册表

**Files:**
- Create: `packages/app/src/lib/tool-registry.ts`

- [ ] **Step 1: 创建 tool-registry.ts**

```typescript
export interface ToolInfo {
  id: string;
  label: string;
}

export const ALL_TOOLS: ToolInfo[] = [
  { id: "read_file", label: "读取文件" },
  { id: "write_file", label: "写入文件" },
  { id: "edit_file", label: "编辑文件" },
  { id: "list_files", label: "列出文件" },
  { id: "search_content", label: "搜索内容" },
  { id: "append_changelog", label: "追加日志" },
  { id: "load_skill", label: "加载技能" },
  { id: "render_card", label: "渲染卡片" },
];

export const ALL_TOOL_IDS = ALL_TOOLS.map((t) => t.id);

export function getToolLabel(id: string): string {
  return ALL_TOOLS.find((t) => t.id === id)?.label ?? id;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/lib/tool-registry.ts
git commit -m "feat: add tool registry with semantic labels"
```

---

### Task 3: 创建 Markdown ↔ 表单转换模块

**Files:**
- Create: `packages/app/src/lib/agent-markdown.ts`

- [ ] **Step 1: 创建 agent-markdown.ts**

```typescript
import yaml from "js-yaml";
import { ALL_TOOL_IDS } from "./tool-registry";

export interface AgentFormData {
  name: string;
  tools: string[];
  context: string[];
  systemPrompt: string;
}

interface ParsedAgent {
  formData: AgentFormData;
  extraFrontmatter: Record<string, unknown>;
}

export function parseAgentMarkdown(raw: string): ParsedAgent {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {
      formData: {
        name: "",
        tools: [...ALL_TOOL_IDS],
        context: [],
        systemPrompt: raw.trim(),
      },
      extraFrontmatter: {},
    };
  }

  const frontmatterRaw = match[1];
  const body = raw.slice(match[0].length).trim();
  const frontmatter = yaml.load(frontmatterRaw) as Record<string, unknown>;

  const { name, tools, context, ...extra } = frontmatter;

  return {
    formData: {
      name: typeof name === "string" ? name : "",
      tools: Array.isArray(tools) ? tools.filter((t): t is string => typeof t === "string") : [...ALL_TOOL_IDS],
      context: Array.isArray(context) ? context.filter((c): c is string => typeof c === "string") : [],
      systemPrompt: body,
    },
    extraFrontmatter: extra,
  };
}

export function buildAgentMarkdown(formData: AgentFormData, extraFrontmatter: Record<string, unknown>, isCreate: boolean): string {
  const frontmatter: Record<string, unknown> = {
    ...extraFrontmatter,
    name: formData.name,
    tools: formData.tools,
    context: formData.context.length > 0 ? formData.context : undefined,
  };

  if (isCreate && !frontmatter.type) {
    frontmatter.type = "creator";
  }

  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, quotingType: '"' }).trim();
  return `---\n${yamlStr}\n---\n\n${formData.systemPrompt}\n`;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/lib/agent-markdown.ts
git commit -m "feat: add agent markdown parser and builder"
```

---

### Task 4: 重写 AgentDialog 为表单 UI

**Files:**
- Modify: `packages/app/src/components/AgentDialog.tsx`

这是核心任务。将整个组件从 textarea 重写为结构化表单。

- [ ] **Step 1: 重写 AgentDialog.tsx**

组件结构：
- 顶部标题栏（创建 Agent / 编辑 Agent）+ 关闭按钮
- 名称输入框
- 工具权限 chips（点击切换）
- 参考资料 tag 输入 + 自动补全
- 提示词 textarea
- 底部取消/保存按钮

关键实现细节：

**名称字段：**
```tsx
<input
  className="w-full px-3 py-2 border border-[var(--border-input)] rounded-md text-[13px] bg-[var(--input-bg)] text-[var(--primary)] outline-none focus:border-accent"
  value={formData.name}
  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
  placeholder="输入 Agent 名称"
/>
```

**工具权限 chips：**
- 使用 `ALL_TOOLS` 映射
- 默认全部选中
- 点击 toggle 选中状态
- 选中的 chip 用 `bg-accent text-white`，未选中用 `bg-[var(--muted-bg)] text-[var(--secondary)] border border-dashed border-[var(--border)]`

```tsx
<div className="flex flex-wrap gap-2">
  {ALL_TOOLS.map((tool) => {
    const selected = formData.tools.includes(tool.id);
    return (
      <button
        key={tool.id}
        type="button"
        className={`px-3 py-1 rounded-md text-[12px] transition-colors ${
          selected
            ? "bg-accent text-white"
            : "bg-[var(--muted-bg)] text-[var(--secondary)] border border-dashed border-[var(--border)]"
        }`}
        onClick={() => {
          const tools = selected
            ? formData.tools.filter((t) => t !== tool.id)
            : [...formData.tools, tool.id];
          setFormData({ ...formData, tools });
        }}
      >
        {tool.label}
      </button>
    );
  })}
</div>
```

**参考资料 tag 输入 + 模糊匹配自动补全：**

需要一个 `contextInput` state 和 `suggestions` state。

模糊匹配逻辑：当用户输入时，按 `/` 分割得到 `dirPart` 和 `filePart`，用 `client.listContent(dirPart)` 获取目录内容，对 `filePart` 做子串匹配（每段都做 includes 匹配，实现模糊效果）。

```tsx
const [contextInput, setContextInput] = useState("");
const [suggestions, setSuggestions] = useState<{ name: string; fullPath: string }[]>([]);
const [showSuggestions, setShowSuggestions] = useState(false);
```

模糊匹配函数：
```typescript
async function fetchSuggestions(input: string) {
  if (!input.trim()) {
    setSuggestions([]);
    setShowSuggestions(false);
    return;
  }
  const lastSlash = input.lastIndexOf("/");
  const dirPart = lastSlash >= 0 ? input.slice(0, lastSlash) : "";
  const filePart = lastSlash >= 0 ? input.slice(lastSlash + 1) : input;
  const segments = filePart.toLowerCase().split(/\s*/);

  try {
    const entries = await client.listContent(dirPart);
    const files = entries
      .filter((e) => e.type === "file")
      .map((e) => ({
        name: e.name,
        fullPath: dirPart ? `${dirPart}/${e.name}` : e.name,
      }))
      .filter((f) => {
        const lower = f.name.toLowerCase();
        return segments.every((seg) => seg === "" || lower.includes(seg));
      })
      .filter((f) => !formData.context.includes(f.fullPath));
    setSuggestions(files.slice(0, 8));
    setShowSuggestions(files.length > 0);
  } catch {
    setSuggestions([]);
    setShowSuggestions(false);
  }
}
```

Tag 输入 + 下拉区域：
```tsx
<div className="relative">
  <div className="flex flex-wrap gap-1.5 p-2 border border-[var(--border-input)] rounded-md min-h-[36px] bg-[var(--input-bg)]">
    {formData.context.map((path) => (
      <span
        key={path}
        className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--muted-bg)] rounded text-[11px] text-[var(--primary)]"
      >
        {path}
        <button
          type="button"
          className="text-[var(--danger)] hover:text-[var(--primary)]"
          onClick={() => setFormData({ ...formData, context: formData.context.filter((c) => c !== path) })}
        >
          ✕
        </button>
      </span>
    ))}
    <input
      className="flex-1 min-w-[120px] border-none outline-none bg-transparent text-[12px] text-[var(--primary)]"
      value={contextInput}
      onChange={(e) => {
        setContextInput(e.target.value);
        fetchSuggestions(e.target.value);
      }}
      onFocus={() => {
        if (contextInput) fetchSuggestions(contextInput);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && contextInput.trim()) {
          e.preventDefault();
          if (!formData.context.includes(contextInput.trim())) {
            setFormData({ ...formData, context: [...formData.context, contextInput.trim()] });
          }
          setContextInput("");
          setSuggestions([]);
          setShowSuggestions(false);
        }
      }}
      placeholder={formData.context.length === 0 ? "输入文件路径，回车添加" : ""}
    />
  </div>
  {showSuggestions && suggestions.length > 0 && (
    <div className="absolute left-0 right-0 top-full mt-1 border border-[var(--border)] rounded-md bg-surface shadow-lg max-h-[160px] overflow-y-auto z-10">
      {suggestions.map((s) => (
        <button
          key={s.fullPath}
          type="button"
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-[var(--hover)] transition-colors"
          onClick={() => {
            if (!formData.context.includes(s.fullPath)) {
              setFormData({ ...formData, context: [...formData.context, s.fullPath] });
            }
            setContextInput("");
            setSuggestions([]);
            setShowSuggestions(false);
          }}
        >
          📄 {s.fullPath}
        </button>
      ))}
    </div>
  )}
</div>
```

**提示词 textarea：**
```tsx
<textarea
  className="w-full min-h-[160px] p-3 border border-[var(--border-input)] rounded-md text-[13px] leading-relaxed resize-y outline-none bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
  value={formData.systemPrompt}
  onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
  spellCheck={false}
/>
```

**组件完整签名：**

```typescript
interface AgentDialogProps {
  mode: "create" | "edit";
  initialContent?: string;
  onSubmit: (filename: string, content: string) => Promise<void>;
  onCancel: () => void;
}
```

组件内部：
- `const [parsed, setParsed] = useState(() => parseAgentMarkdown(initialContent ?? ""))`
- `const [formData, setFormData] = useState<AgentFormData>(parsed.formData)`
- 需要 `client: ApiClient` 用于参考资料 autocomplete。从 props 传入或通过 context 获取。查看 ProjectPage 的调用方式，当前不传 client。需要新增 `client` prop。

**修改 props 接口：**
```typescript
interface AgentDialogProps {
  mode: "create" | "edit";
  initialContent?: string;
  client: ApiClient;
  onSubmit: (filename: string, content: string) => Promise<void>;
  onCancel: () => void;
}
```

**提交逻辑：**
```typescript
const handleSubmit = async () => {
  if (!formData.name.trim()) {
    setError("请输入 Agent 名称");
    return;
  }
  setSaving(true);
  setError(null);
  const content = buildAgentMarkdown(formData, parsed.extraFrontmatter, mode === "create");
  const filename = `${formData.name.trim()}.md`;
  try {
    await onSubmit(filename, content);
  } catch (err: any) {
    setError(err.message);
    setSaving(false);
  }
};
```

**默认创建模板：** 创建模式下 `initialContent` 为 undefined 时，使用 AGENT_TEMPLATE 作为初始解析内容。

完整文件参考（需要写入的实际代码）：

```tsx
import { useState, useMemo } from "react";
import { AGENT_TEMPLATE } from "@spherse/presets";
import type { ApiClient } from "../lib/api";
import { ALL_TOOLS } from "../lib/tool-registry";
import { parseAgentMarkdown, buildAgentMarkdown } from "../lib/agent-markdown";
import type { AgentFormData } from "../lib/agent-markdown";

interface AgentDialogProps {
  mode: "create" | "edit";
  initialContent?: string;
  client: ApiClient;
  onSubmit: (filename: string, content: string) => Promise<void>;
  onCancel: () => void;
}

export function AgentDialog({ mode, initialContent, client, onSubmit, onCancel }: AgentDialogProps) {
  const raw = initialContent ?? AGENT_TEMPLATE;
  const parsed = useMemo(() => parseAgentMarkdown(raw), [raw]);
  const [formData, setFormData] = useState<AgentFormData>(parsed.formData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextInput, setContextInput] = useState("");
  const [suggestions, setSuggestions] = useState<{ name: string; fullPath: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const fetchSuggestions = async (input: string) => {
    if (!input.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const lastSlash = input.lastIndexOf("/");
    const dirPart = lastSlash >= 0 ? input.slice(0, lastSlash) : "";
    const filePart = lastSlash >= 0 ? input.slice(lastSlash + 1) : input;
    const segments = filePart.toLowerCase().split(/\s+/).filter(Boolean);
    try {
      const entries = await client.listContent(dirPart);
      const files = entries
        .filter((e) => e.type === "file")
        .map((e) => ({
          name: e.name,
          fullPath: dirPart ? `${dirPart}/${e.name}` : e.name,
        }))
        .filter((f) => {
          const lower = f.name.toLowerCase();
          return segments.length === 0 || segments.every((seg) => lower.includes(seg));
        })
        .filter((f) => !formData.context.includes(f.fullPath));
      setSuggestions(files.slice(0, 8));
      setShowSuggestions(files.length > 0);
    } catch {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const addContext = (path: string) => {
    if (!formData.context.includes(path)) {
      setFormData((prev) => ({ ...prev, context: [...prev.context, path] }));
    }
    setContextInput("");
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setError("请输入 Agent 名称");
      return;
    }
    setSaving(true);
    setError(null);
    const content = buildAgentMarkdown(formData, parsed.extraFrontmatter, mode === "create");
    const filename = `${formData.name.trim()}.md`;
    try {
      await onSubmit(filename, content);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[var(--overlay)] flex items-center justify-center z-[100]" onClick={onCancel}>
      <div
        className="bg-surface rounded-[10px] w-[600px] max-h-[80vh] flex flex-col shadow-[var(--shadow-dialog)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-light)]">
          <h2 className="text-base font-semibold text-[var(--primary)]">
            {mode === "create" ? "创建 Agent" : "编辑 Agent"}
          </h2>
          <button className="bg-none text-lg text-[var(--muted)] p-1 hover:text-[var(--primary)]" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-1.5">
              名称
            </label>
            <input
              className="w-full px-3 py-2 border border-[var(--border-input)] rounded-md text-[13px] bg-[var(--input-bg)] text-[var(--primary)] outline-none focus:border-accent"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="输入 Agent 名称"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-1.5">
              工具权限
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_TOOLS.map((tool) => {
                const selected = formData.tools.includes(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    className={`px-3 py-1 rounded-md text-[12px] transition-colors ${
                      selected
                        ? "bg-accent text-white"
                        : "bg-[var(--muted-bg)] text-[var(--secondary)] border border-dashed border-[var(--border)]"
                    }`}
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        tools: selected
                          ? prev.tools.filter((t) => t !== tool.id)
                          : [...prev.tools, tool.id],
                      }))
                    }
                  >
                    {tool.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-1.5">
              参考资料
            </label>
            <div className="relative">
              <div className="flex flex-wrap gap-1.5 p-2 border border-[var(--border-input)] rounded-md min-h-[36px] bg-[var(--input-bg)]">
                {formData.context.map((path) => (
                  <span
                    key={path}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--muted-bg)] rounded text-[11px] text-[var(--primary)]"
                  >
                    {path}
                    <button
                      type="button"
                      className="text-[var(--danger)] hover:text-[var(--primary)]"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          context: prev.context.filter((c) => c !== path),
                        }))
                      }
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <input
                  className="flex-1 min-w-[120px] border-none outline-none bg-transparent text-[12px] text-[var(--primary)]"
                  value={contextInput}
                  onChange={(e) => {
                    setContextInput(e.target.value);
                    fetchSuggestions(e.target.value);
                  }}
                  onFocus={() => {
                    if (contextInput) fetchSuggestions(contextInput);
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowSuggestions(false), 150);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && contextInput.trim()) {
                      e.preventDefault();
                      addContext(contextInput.trim());
                    }
                  }}
                  placeholder={formData.context.length === 0 ? "输入文件路径，回车添加" : ""}
                />
              </div>
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 border border-[var(--border)] rounded-md bg-surface shadow-lg max-h-[160px] overflow-y-auto z-10">
                  {suggestions.map((s) => (
                    <button
                      key={s.fullPath}
                      type="button"
                      className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-[var(--hover)] transition-colors"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addContext(s.fullPath);
                      }}
                    >
                      📄 {s.fullPath}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-1.5">
              提示词
            </label>
            <textarea
              className="w-full min-h-[160px] p-3 border border-[var(--border-input)] rounded-md text-[13px] leading-relaxed resize-y outline-none bg-[var(--input-bg)] text-[var(--primary)] focus:border-accent"
              value={formData.systemPrompt}
              onChange={(e) => setFormData((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              spellCheck={false}
            />
          </div>

          {error && <p className="text-danger text-xs">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-light)]">
          <button
            className="px-4 py-1.5 bg-[var(--muted-bg)] rounded-[5px] text-[13px] text-[var(--on-muted)] hover:bg-[var(--border)]"
            onClick={onCancel}
          >
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

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/AgentDialog.tsx
git commit -m "feat: rewrite AgentDialog as structured form UI"
```

---

### Task 5: 更新 ProjectPage 传递 client prop

**Files:**
- Modify: `packages/app/src/pages/ProjectPage.tsx`

- [ ] **Step 1: 更新两处 AgentDialog 调用，传入 client prop**

在 ProjectPage.tsx 中有两处使用 `<AgentDialog>`，需要各加 `client={ctx.client}`。

创建模式（约第 301 行）：
```tsx
<AgentDialog
  mode="create"
  client={ctx.client}
  onSubmit={handleCreateAgent}
  onCancel={() => setShowCreateAgent(false)}
/>
```

编辑模式（约第 307 行）：
```tsx
<AgentDialog
  mode="edit"
  initialContent={editAgent.content}
  client={ctx.client}
  onSubmit={handleEditSubmit}
  onCancel={() => setEditAgent(null)}
/>
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/pages/ProjectPage.tsx
git commit -m "feat: pass client to AgentDialog for file autocomplete"
```

---

### Task 6: 构建验证

- [ ] **Step 1: 运行构建确认无报错**

```bash
npm run build --workspace=packages/app
```

Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 2: 手动启动应用验证**

```bash
npm run dev --workspace=packages/core && npm run dev --workspace=packages/server && npm run dev
```

验证点：
1. 点击 "+" 创建 Agent → 弹出表单，四个字段都有
2. 工具权限默认全选，点击可切换
3. 参考资料输入路径时有自动补全下拉
4. 提示词 textarea 内容正常
5. 提交后 agent 列表刷新，新 agent 显示正确
6. 编辑已有 agent → 表单正确回填各字段
7. 编辑包含 output/schedule 等额外字段的 agent → 保存后额外字段不丢失
