# HTML Viewer Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `render_card` tool that lets agents render HTML content as visual cards in the chat flow.

**Architecture:** New `render_card` tool in core layer uses `onUpdate` callback to push card data through pi-agent-core's `tool_execution_update` event. Frontend detects `render_card` tool calls, extracts card data from `tool_execution_update`, and renders HTML via sandboxed iframe.

**Tech Stack:** @sinclair/typebox (tool param schema), React + iframe srcDoc (rendering), Vitest (testing)

---

## File Structure

| Operation | File | Responsibility |
|-----------|------|----------------|
| Create | `packages/core/src/tools/render-card.ts` | render_card tool implementation |
| Modify | `packages/core/src/tools/index.ts` | Register render_card in tool factory |
| Create | `packages/core/src/__tests__/tools/render-card.test.ts` | Unit tests for render_card |
| Modify | `packages/app/src/lib/types.ts` | Add HtmlCard type, extend ToolCallInfo |
| Create | `packages/app/src/components/HtmlCard.tsx` | HTML card iframe renderer component |
| Modify | `packages/app/src/pages/ChatPage.tsx` | Handle render_card events + render cards + history recovery |

---

### Task 1: render_card Tool Implementation

**Files:**
- Create: `packages/core/src/tools/render-card.ts`
- Test: `packages/core/src/__tests__/tools/render-card.test.ts`
- Reference: `packages/core/src/tools/read-file.ts` (pattern for path validation)

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/tools/render-card.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRenderCardTool } from "../../tools/render-card.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("createRenderCardTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("sends card data via onUpdate for inline HTML content", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();
    const html = "<h1>Hello World</h1>";

    const result = await tool.execute(
      "tc1",
      { type: "html", content: html },
      undefined as any,
      onUpdate,
    );

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const cardData = onUpdate.mock.calls[0][0];
    expect(cardData).toEqual({
      type: "html",
      html,
      title: undefined,
      width: undefined,
      height: 400,
      max_width: 800,
      max_height: 600,
    });
    expect(result.content[0].text).toBe("HTML card rendered successfully");
  });

  it("sends card data with custom dimensions", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    await tool.execute(
      "tc1",
      { type: "html", content: "<p>test</p>", width: 500, height: 300, max_width: 600, max_height: 500 },
      undefined as any,
      onUpdate,
    );

    const cardData = onUpdate.mock.calls[0][0];
    expect(cardData.width).toBe(500);
    expect(cardData.height).toBe(300);
    expect(cardData.max_width).toBe(600);
    expect(cardData.max_height).toBe(500);
  });

  it("sends card data with title", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    await tool.execute(
      "tc1",
      { type: "html", content: "<p>test</p>", title: "My Card" },
      undefined as any,
      onUpdate,
    );

    const cardData = onUpdate.mock.calls[0][0];
    expect(cardData.title).toBe("My Card");
  });

  it("reads HTML from file_path", async () => {
    await writeFile(projectRoot, "output/report.html", "<h2>Report</h2>");
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    const result = await tool.execute(
      "tc1",
      { type: "html", file_path: "output/report.html" },
      undefined as any,
      onUpdate,
    );

    const cardData = onUpdate.mock.calls[0][0];
    expect(cardData.html).toBe("<h2>Report</h2>");
    expect(result.content[0].text).toBe("HTML card rendered successfully");
  });

  it("returns error when neither content nor file_path is provided", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    const result = await tool.execute(
      "tc1",
      { type: "html" },
      undefined as any,
      onUpdate,
    );

    expect(result.content[0].text).toContain("must provide");
    expect(result.details?.error).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("returns error when file_path does not exist", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    const result = await tool.execute(
      "tc1",
      { type: "html", file_path: "nonexistent.html" },
      undefined as any,
      onUpdate,
    );

    expect(result.content[0].text).toContain("Error");
    expect(result.details?.error).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("rejects path traversal in file_path", async () => {
    const tool = createRenderCardTool(projectRoot);

    await expect(
      tool.execute(
        "tc1",
        { type: "html", file_path: "../../../etc/passwd" },
        undefined as any,
        undefined as any,
      ),
    ).rejects.toThrow("Path traversal denied");
  });

  it("prefers file_path over content when both provided", async () => {
    await writeFile(projectRoot, "chart.html", "<canvas></canvas>");
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    await tool.execute(
      "tc1",
      { type: "html", content: "<p>inline</p>", file_path: "chart.html" },
      undefined as any,
      onUpdate,
    );

    const cardData = onUpdate.mock.calls[0][0];
    expect(cardData.html).toBe("<canvas></canvas>");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- --run --reporter=verbose render-card`
Expected: FAIL — module not found

- [ ] **Step 3: Create the render_card tool**

Create `packages/core/src/tools/render-card.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const RenderCardParams = Type.Object({
  type: Type.Literal("html", { description: "Card type" }),
  content: Type.Optional(Type.String({ description: "Inline HTML content to render" })),
  file_path: Type.Optional(Type.String({ description: "Path to HTML file relative to project root" })),
  title: Type.Optional(Type.String({ description: "Card title" })),
  width: Type.Optional(Type.Number({ description: "Card width in pixels" })),
  height: Type.Optional(Type.Number({ description: "Card height in pixels (default 400)" })),
  max_width: Type.Optional(Type.Number({ description: "Maximum width in pixels (default 800)" })),
  max_height: Type.Optional(Type.Number({ description: "Maximum height in pixels (default 600)" })),
});

function validatePath(projectRoot: string, relativePath: string): string {
  const resolved = path.resolve(projectRoot, relativePath);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

export function createRenderCardTool(projectRoot: string): AgentTool<typeof RenderCardParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "render_card",
    label: "Render Card",
    description:
      "Render HTML content as a visual card in the chat. Use this to display rich HTML content such as web pages, charts, diagrams, or styled documents. You can provide HTML inline via the `content` parameter or reference a project file via `file_path`. Use `width`, `height`, `max_width`, and `max_height` to control the card dimensions.",
    parameters: RenderCardParams,
    async execute(_toolCallId, params, _signal, onUpdate) {
      let html: string;

      if (params.file_path) {
        const resolved = validatePath(root, params.file_path);
        try {
          html = await fs.readFile(resolved, "utf-8");
        } catch {
          return {
            content: [{ type: "text" as const, text: `Error: file not found at ${params.file_path}` }],
            details: { error: true },
          };
        }
      } else if (params.content) {
        html = params.content;
      } else {
        return {
          content: [{ type: "text" as const, text: "Error: must provide either `content` or `file_path`" }],
          details: { error: true },
        };
      }

      const cardData = {
        type: "html" as const,
        html,
        title: params.title,
        width: params.width,
        height: params.height ?? 400,
        max_width: params.max_width ?? 800,
        max_height: params.max_height ?? 600,
      };

      onUpdate?.(cardData);

      return {
        content: [{ type: "text" as const, text: "HTML card rendered successfully" }],
        details: { cardType: "html", title: params.title },
      };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- --run --reporter=verbose render-card`
Expected: All 8 tests PASS

- [ ] **Step 5: Register the tool in the factory**

Modify `packages/core/src/tools/index.ts` — add import and registration:

Add after line 8:
```typescript
import { createRenderCardTool } from "./render-card.js";
```

Add after line 16:
```typescript
export { createRenderCardTool } from "./render-card.js";
```

Add after line 29 (the `append_changelog` line):
```typescript
    render_card: createRenderCardTool(projectRoot),
```

- [ ] **Step 6: Run all core tests to verify nothing is broken**

Run: `npm test --workspace=packages/core -- --run`
Expected: All tests PASS

---

### Task 2: Frontend Type Extensions

**Files:**
- Modify: `packages/app/src/lib/types.ts`

- [ ] **Step 1: Add HtmlCard type and extend ToolCallInfo**

Modify `packages/app/src/lib/types.ts`.

Add before `ToolCallInfo` (after line 30):

```typescript
export interface HtmlCard {
  type: "html";
  html: string;
  title?: string;
  width?: number;
  height?: number;
  max_width?: number;
  max_height?: number;
}
```

Add `_card?: HtmlCard` field to `ToolCallInfo` (after line 45):

```typescript
  _card?: HtmlCard;
```

The final `ToolCallInfo` should be:

```typescript
export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  partialResult?: string;
  status: "running" | "completed" | "error";
  _card?: HtmlCard;
}
```

---

### Task 3: HtmlCard Renderer Component

**Files:**
- Create: `packages/app/src/components/HtmlCard.tsx`

- [ ] **Step 1: Create the HtmlCard renderer component**

Create `packages/app/src/components/HtmlCard.tsx`:

```typescript
import type { HtmlCard } from "../lib/types";

interface HtmlCardRendererProps {
  card: HtmlCard;
}

export function HtmlCardRenderer({ card }: HtmlCardRendererProps) {
  const width = card.width ? `${Math.min(card.width, card.max_width ?? 800)}px` : "100%";
  const height = Math.min(card.height ?? 400, card.max_height ?? 600);

  return (
    <div
      className="my-2 rounded-lg border border-[var(--border)] overflow-hidden"
      style={{ maxWidth: `${card.max_width ?? 800}px`, width }}
    >
      {card.title && (
        <div className="px-3 py-1.5 text-xs font-semibold bg-[var(--muted-bg)] text-[var(--secondary)] border-b border-[var(--border)]">
          {card.title}
        </div>
      )}
      <iframe
        srcDoc={card.html}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: "100%",
          height: `${height}px`,
          border: "none",
          display: "block",
        }}
      />
    </div>
  );
}
```

---

### Task 4: ChatPage Event Handling & Rendering

**Files:**
- Modify: `packages/app/src/pages/ChatPage.tsx`

- [ ] **Step 1: Add import for HtmlCardRenderer**

Add import at top of `packages/app/src/pages/ChatPage.tsx` (after line 6):

```typescript
import { HtmlCardRenderer } from "../components/HtmlCard";
```

- [ ] **Step 2: Handle render_card in tool_execution_update event**

In the `handleWsEvent` callback, modify the `tool_execution_update` branch (lines 210-222).

Replace the existing `tool_execution_update` handler block with:

```typescript
    } else if (event.type === "tool_execution_update") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last._toolCalls) {
          const calls = last._toolCalls.map((tc) => {
            if (tc.toolCallId !== event.toolCallId) return tc;
            const updated = {
              ...tc,
              partialResult: typeof event.partialResult === "string" ? event.partialResult : JSON.stringify(event.partialResult),
            };
            if (
              tc.toolName === "render_card" &&
              event.partialResult &&
              typeof event.partialResult === "object" &&
              event.partialResult.type === "html"
            ) {
              (updated as any)._card = event.partialResult;
            }
            return updated;
          });
          return [...prev.slice(0, -1), { ...last, _toolCalls: calls }];
        }
        return prev;
      });
```

- [ ] **Step 3: Recover card data from history messages**

In the history loading logic (the `useEffect` that starts at line 64), modify the `toolCalls` mapping (lines 96-110) to recover `_card` for `render_card` tool calls.

Replace the toolCalls mapping block (lines 96-110) with:

```typescript
        const toolCalls: ToolCallInfo[] | undefined =
          Array.isArray(m.content)
            ? m.content
                .filter((c: any) => c.type === "toolCall")
                .map((c: any) => {
                  const tr = toolResultMap.get(c.id);
                  const base: ToolCallInfo = {
                    toolCallId: c.id,
                    toolName: c.name,
                    args: c.arguments ?? {},
                    result: tr?.result,
                    status: tr ? (tr.isError ? "error" as const : "completed" as const) : "completed" as const,
                  };
                  if (
                    c.name === "render_card" &&
                    c.arguments?.type === "html" &&
                    (c.arguments.content || c.arguments.file_path)
                  ) {
                    base._card = {
                      type: "html",
                      html: c.arguments.content ?? "",
                      title: c.arguments.title,
                      width: c.arguments.width,
                      height: c.arguments.height ?? 400,
                      max_width: c.arguments.max_width ?? 800,
                      max_height: c.arguments.max_height ?? 600,
                    };
                  }
                  return base;
                })
            : undefined;
```

- [ ] **Step 4: Render HtmlCardRenderer in message bubble**

In the message rendering section (around line 285-287), after the `ToolCallSection`, add card rendering.

Replace lines 285-287:

```tsx
            {msg._toolCalls && msg._toolCalls.length > 0 && (
              <ToolCallSection toolCalls={msg._toolCalls} />
            )}
```

With:

```tsx
            {msg._toolCalls && msg._toolCalls.length > 0 && (
              <ToolCallSection toolCalls={msg._toolCalls} />
            )}
            {msg._toolCalls
              ?.filter((tc) => tc._card)
              .map((tc) => (
                <HtmlCardRenderer key={tc.toolCallId} card={tc._card!} />
              ))}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors

---

### Task 5: Verification & Build

- [ ] **Step 1: Run all core tests**

Run: `npm test --workspace=packages/core -- --run`
Expected: All tests PASS

- [ ] **Step 2: Build all packages**

Run: `npm run build`
Expected: Build succeeds with no errors
