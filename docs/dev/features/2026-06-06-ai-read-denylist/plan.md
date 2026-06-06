# AI Read Denylist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-level AI read denylist configured from the file tree header and enforced by core agent file-reading paths.

**Architecture:** Store `aiAccess.deniedPaths` in `.spherse/project.yaml`, expose it through dedicated project settings APIs, and enforce it in core through a shared file access policy. The renderer only edits structured settings; all path normalization, reserved-path validation, and enforcement live in core so active agents and future sessions use the same rules.

**Tech Stack:** TypeScript ESM, React, Fastify, Electron renderer API client, pi-agent-core `AgentTool`, `@sinclair/typebox`, Vitest, shadcn/ui, Tailwind CSS v4.

---

## File Structure

- Create `packages/core/src/access/ai-file-access.ts`: normalize denylist paths, reject reserved paths, and provide a policy object with `isDenied()` / `assertReadableByAi()`.
- Create `packages/core/src/__tests__/access/ai-file-access.test.ts`: pure unit tests for normalization and matching.
- Modify `packages/core/src/types.ts`: add `ProjectConfig.aiAccess?: { deniedPaths: string[] }`.
- Modify `packages/core/src/store/project.ts`: add `getAiAccessSettings()` and `updateAiAccessSettings()` methods, persist to `project.yaml`, keep in-memory config synchronized.
- Modify `packages/core/src/__tests__/store/project.test.ts`: cover loading default empty settings, saving normalized denylist, and rejecting reserved paths.
- Modify `packages/core/src/tools/read-file.ts`, `list-files.ts`, `search-content.ts`, `render-card.ts`, `edit-file.ts`: accept an access policy provider and deny reads with path-including tool result text.
- Modify `packages/core/src/tools/index.ts`: pass a policy provider to relevant tool factories.
- Modify `packages/core/src/engine/read-context-files.ts`: skip denied context files.
- Modify `packages/core/src/engine.ts`: create the policy provider from `ProjectStore`, pass it into tools and context loading.
- Modify existing core tool/context tests under `packages/core/src/__tests__/tools/` and `packages/core/src/__tests__/engine/`.
- Modify `packages/server/src/routes/settings.ts`: add `GET /api/settings/ai-access` and `PUT /api/settings/ai-access`.
- Modify `packages/app/src/lib/api.ts`: add `getAiAccessSettings()` and `updateAiAccessSettings()`.
- Create `packages/app/src/features/file-tree/useAiReadDenylist.ts`: local hook for loading, editing, validating, and saving denylist paths.
- Create `packages/app/src/features/file-tree/AiReadDenylistDialog.tsx`: dialog UI.
- Modify `packages/app/src/features/project-panel/index.tsx`: add file-tree header settings button and dialog state.
- Create `packages/app/src/features/file-tree/useAiReadDenylist.test.ts`: cover renderer-side path normalization and reserved-path rejection.
- Modify `docs/official/architecture.md` and `docs/official/data-conventions.md`: document the new setting and enforcement boundary.

## Task 1: Core Access Policy

**Files:**
- Create: `packages/core/src/access/ai-file-access.ts`
- Create: `packages/core/src/__tests__/access/ai-file-access.test.ts`

- [ ] **Step 1: Write failing access policy tests**

Create `packages/core/src/__tests__/access/ai-file-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createAiFileAccessPolicy,
  normalizeDeniedPath,
  normalizeDeniedPaths,
} from "../../access/ai-file-access.js";

describe("ai-file-access", () => {
  it("normalizes valid project-relative paths", () => {
    expect(normalizeDeniedPath(" secrets\\key.md ")).toBe("secrets/key.md");
    expect(normalizeDeniedPath("./notes/private.md")).toBe("notes/private.md");
  });

  it("rejects empty, root, path traversal, and absolute paths", () => {
    expect(normalizeDeniedPath("")).toBeNull();
    expect(normalizeDeniedPath(".")).toBeNull();
    expect(normalizeDeniedPath("../secret.md")).toBeNull();
    expect(normalizeDeniedPath("/secret.md")).toBeNull();
  });

  it("rejects reserved project mechanism paths", () => {
    expect(normalizeDeniedPath("AGENTS.md")).toBeNull();
    expect(normalizeDeniedPath("CHANGELOG.md")).toBeNull();
    expect(normalizeDeniedPath(".spherse")).toBeNull();
    expect(normalizeDeniedPath(".spherse/project.yaml")).toBeNull();
  });

  it("deduplicates normalized paths", () => {
    expect(normalizeDeniedPaths(["secrets", "./secrets", "notes/a.md"])).toEqual([
      "secrets",
      "notes/a.md",
    ]);
  });

  it("matches files and recursive directory children without prefix false positives", () => {
    const policy = createAiFileAccessPolicy("/project", ["secrets", "notes/private.md"]);
    expect(policy.isDenied("secrets")).toBe(true);
    expect(policy.isDenied("secrets/key.md")).toBe(true);
    expect(policy.isDenied("notes/private.md")).toBe(true);
    expect(policy.isDenied("secret-notes/key.md")).toBe(false);
    expect(policy.isDenied("notes/public.md")).toBe(false);
  });

  it("throws denial errors that include the blocked path", () => {
    const policy = createAiFileAccessPolicy("/project", ["secrets/key.md"]);
    expect(() => policy.assertReadableByAi("secrets/key.md")).toThrow(
      "Access denied by AI read settings: secrets/key.md",
    );
  });
});
```

- [ ] **Step 2: Run policy tests and verify failure**

Run: `npm test --workspace=packages/core -- ai-file-access`

Expected: FAIL because `packages/core/src/access/ai-file-access.ts` does not exist.

- [ ] **Step 3: Implement access policy**

Create `packages/core/src/access/ai-file-access.ts`:

```ts
import path from "node:path";

export interface AiFileAccessPolicy {
  deniedPaths: readonly string[];
  isDenied(relativePath: string): boolean;
  assertReadableByAi(relativePath: string): void;
}

export function normalizeDeniedPath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === ".") return null;
  if (path.isAbsolute(trimmed)) return null;

  const normalized = path.posix.normalize(trimmed.replace(/^\.\//, ""));
  if (!normalized || normalized === ".") return null;
  if (normalized === ".." || normalized.startsWith("../")) return null;
  if (isReservedAiDenyPath(normalized)) return null;
  return normalized;
}

export function normalizeDeniedPaths(inputs: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const input of inputs) {
    const normalized = normalizeDeniedPath(input);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function isReservedAiDenyPath(relativePath: string): boolean {
  return (
    relativePath === "AGENTS.md" ||
    relativePath === "CHANGELOG.md" ||
    relativePath === ".spherse" ||
    relativePath.startsWith(".spherse/")
  );
}

export function createAiFileAccessPolicy(
  _projectRoot: string,
  deniedPaths: readonly string[],
): AiFileAccessPolicy {
  const normalizedDeniedPaths = normalizeDeniedPaths(deniedPaths);

  return {
    deniedPaths: normalizedDeniedPaths,
    isDenied(relativePath: string): boolean {
      const normalized = normalizeDeniedPathForCheck(relativePath);
      if (!normalized) return true;
      return normalizedDeniedPaths.some(
        (deniedPath) => normalized === deniedPath || normalized.startsWith(`${deniedPath}/`),
      );
    },
    assertReadableByAi(relativePath: string): void {
      const normalized = normalizeDeniedPathForCheck(relativePath) ?? relativePath;
      if (this.isDenied(relativePath)) {
        throw new Error(`Access denied by AI read settings: ${normalized}`);
      }
    },
  };
}

function normalizeDeniedPathForCheck(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === ".") return "";
  if (path.isAbsolute(trimmed)) return null;
  const normalized = path.posix.normalize(trimmed.replace(/^\.\//, ""));
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized === "." ? "" : normalized;
}
```

- [ ] **Step 4: Run policy tests and verify pass**

Run: `npm test --workspace=packages/core -- ai-file-access`

Expected: PASS for all `ai-file-access` tests.

## Task 2: ProjectStore Persistence

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/store/project.ts`
- Modify: `packages/core/src/__tests__/store/project.test.ts`

- [ ] **Step 1: Write failing ProjectStore tests**

Add tests to `packages/core/src/__tests__/store/project.test.ts`:

```ts
it("returns empty AI access settings by default", async () => {
  const dir = await createTempProject();
  try {
    const store = new ProjectStore(dir);
    await store.create("World", "openai/gpt-4o-mini");
    expect(store.getAiAccessSettings()).toEqual({ deniedPaths: [] });
  } finally {
    await cleanupDir(dir);
  }
});

it("persists normalized AI denied paths", async () => {
  const dir = await createTempProject();
  try {
    const store = new ProjectStore(dir);
    await store.create("World", "openai/gpt-4o-mini");
    const saved = await store.updateAiAccessSettings([
      " secrets\\key.md ",
      "./secrets/key.md",
      "notes/private.md",
    ]);
    expect(saved).toEqual({ deniedPaths: ["secrets/key.md", "notes/private.md"] });

    const reopened = new ProjectStore(dir);
    await reopened.open();
    expect(reopened.getAiAccessSettings()).toEqual({
      deniedPaths: ["secrets/key.md", "notes/private.md"],
    });
  } finally {
    await cleanupDir(dir);
  }
});

it("rejects reserved AI denied paths", async () => {
  const dir = await createTempProject();
  try {
    const store = new ProjectStore(dir);
    await store.create("World", "openai/gpt-4o-mini");
    await expect(store.updateAiAccessSettings(["AGENTS.md"])).rejects.toThrow(
      "Invalid AI denied path: AGENTS.md",
    );
    await expect(store.updateAiAccessSettings([".spherse/project.yaml"])).rejects.toThrow(
      "Invalid AI denied path: .spherse/project.yaml",
    );
  } finally {
    await cleanupDir(dir);
  }
});
```

- [ ] **Step 2: Run ProjectStore tests and verify failure**

Run: `npm test --workspace=packages/core -- project.test.ts`

Expected: FAIL because `getAiAccessSettings()` and `updateAiAccessSettings()` do not exist.

- [ ] **Step 3: Extend `ProjectConfig` type**

Modify `packages/core/src/types.ts`:

```ts
export interface ProjectConfig {
  name: string;
  created: number;
  defaultModel: string;
  paths: {
    agents: string;
    index: string;
    changelog: string;
  };
  aiAccess?: {
    deniedPaths: string[];
  };
}
```

- [ ] **Step 4: Add ProjectStore settings methods**

Modify `packages/core/src/store/project.ts` imports and class:

```ts
import { normalizeDeniedPath, normalizeDeniedPaths } from "../access/ai-file-access.js";
```

Add methods inside `ProjectStore`:

```ts
  getAiAccessSettings(): { deniedPaths: string[] } {
    return { deniedPaths: [...(this.config?.aiAccess?.deniedPaths ?? [])] };
  }

  async updateAiAccessSettings(deniedPaths: string[]): Promise<{ deniedPaths: string[] }> {
    if (!this.config) {
      throw new Error("Project is not open");
    }

    for (const deniedPath of deniedPaths) {
      if (normalizeDeniedPath(deniedPath) === null) {
        throw new Error(`Invalid AI denied path: ${deniedPath}`);
      }
    }

    const normalized = normalizeDeniedPaths(deniedPaths);
    this.config = {
      ...this.config,
      aiAccess: { deniedPaths: normalized },
    };

    const configPath = path.join(this.spherseDir, "project.yaml");
    await fs.writeFile(configPath, YAML.stringify(this.config), "utf-8");
    return { deniedPaths: normalized };
  }
```

- [ ] **Step 5: Run ProjectStore tests and verify pass**

Run: `npm test --workspace=packages/core -- project.test.ts`

Expected: PASS for ProjectStore tests.

## Task 3: Enforce Policy In Core Tools And Context

**Files:**
- Modify: `packages/core/src/tools/read-file.ts`
- Modify: `packages/core/src/tools/list-files.ts`
- Modify: `packages/core/src/tools/search-content.ts`
- Modify: `packages/core/src/tools/render-card.ts`
- Modify: `packages/core/src/tools/edit-file.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/engine/read-context-files.ts`
- Modify: `packages/core/src/engine.ts`
- Modify tests under `packages/core/src/__tests__/tools/` and `packages/core/src/__tests__/engine/`

- [ ] **Step 1: Add failing tool/context tests**

Update existing tests with these cases. Use the existing helpers from `packages/core/src/__tests__/helpers.ts`: `createTempProject`, `cleanupDir`, `writeFile`, and `ensureDir`.

```ts
it("denies reading a blocked file and includes the path", async () => {
  const dir = await createTempProject();
  try {
    await writeFile(dir, "secrets/key.md", "secret");
    const policy = () => createAiFileAccessPolicy(dir, ["secrets/key.md"]);
    const tool = createReadFileTool(dir, policy);
    const result = await tool.execute("call", { path: "secrets/key.md" }, new AbortController().signal);
    expect(result.content[0]?.text).toContain("Access denied by AI read settings: secrets/key.md");
    expect(result.content[0]?.text).not.toContain("secret");
  } finally {
    await cleanupDir(dir);
  }
});

it("omits blocked entries from list_files and denies listing blocked paths", async () => {
  const dir = await createTempProject();
  try {
    await ensureDir(dir, "secrets");
    await writeFile(dir, "public.md", "public");
    const policy = () => createAiFileAccessPolicy(dir, ["secrets"]);
    const tool = createListFilesTool(dir, policy);
    const rootResult = await tool.execute("call", { path: "", recursive: false }, new AbortController().signal);
    expect(rootResult.content[0]?.text).not.toContain("secrets");
    expect(rootResult.content[0]?.text).toContain("public.md");
    const deniedResult = await tool.execute("call", { path: "secrets", recursive: false }, new AbortController().signal);
    expect(deniedResult.content[0]?.text).toContain("Access denied by AI read settings: secrets");
  } finally {
    await cleanupDir(dir);
  }
});

it("skips blocked files in search_content and denies blocked search roots", async () => {
  const dir = await createTempProject();
  try {
    await writeFile(dir, "secrets/key.md", "needle secret");
    await writeFile(dir, "public.md", "needle public");
    const policy = () => createAiFileAccessPolicy(dir, ["secrets"]);
    const tool = createSearchContentTool(dir, policy);
    const result = await tool.execute("call", { query: "needle" }, new AbortController().signal);
    expect(result.content[0]?.text).toContain("public.md");
    expect(result.content[0]?.text).not.toContain("secrets/key.md");
    expect(result.content[0]?.text).not.toContain("needle secret");
    const deniedResult = await tool.execute("call", { query: "needle", path: "secrets" }, new AbortController().signal);
    expect(deniedResult.content[0]?.text).toContain("Access denied by AI read settings: secrets");
  } finally {
    await cleanupDir(dir);
  }
});

it("denies render_card file_path without returning HTML", async () => {
  const dir = await createTempProject();
  try {
    await writeFile(dir, "secrets/card.html", "<strong>secret</strong>");
    const policy = () => createAiFileAccessPolicy(dir, ["secrets"]);
    const tool = createRenderCardTool(dir, policy);
    const result = await tool.execute("call", { type: "html", file_path: "secrets/card.html" }, new AbortController().signal);
    expect(result.content[0]?.text).toContain("Access denied by AI read settings: secrets/card.html");
    expect(JSON.stringify(result.details)).not.toContain("secret");
  } finally {
    await cleanupDir(dir);
  }
});

it("denies edit_file for blocked paths because it reads before writing", async () => {
  const dir = await createTempProject();
  try {
    await writeFile(dir, "secrets/key.md", "old secret");
    const policy = () => createAiFileAccessPolicy(dir, ["secrets"]);
    const tool = createEditFileTool(dir, new FileWriteMutex(), policy);
    const result = await tool.execute("call", { path: "secrets/key.md", old_string: "old", new_string: "new" }, new AbortController().signal);
    expect(result.content[0]?.text).toContain("Access denied by AI read settings: secrets/key.md");
  } finally {
    await cleanupDir(dir);
  }
});

it("skips blocked context files", async () => {
  const dir = await createTempProject();
  try {
    await writeFile(dir, "secrets/key.md", "secret context");
    const policy = () => createAiFileAccessPolicy(dir, ["secrets"]);
    const result = await readContextFiles(dir, ["secrets/key.md"], policy);
    expect(result).toBe("");
  } finally {
    await cleanupDir(dir);
  }
});
```

- [ ] **Step 2: Run targeted core tests and verify failure**

Run: `npm test --workspace=packages/core -- read-file list-files search-content render-card edit-file read-context-files`

Expected: FAIL because tool factories and `readContextFiles` do not accept policies yet.

- [ ] **Step 3: Introduce policy provider type and update tool factories**

In each affected tool file, add:

```ts
import type { AiFileAccessPolicy } from "../access/ai-file-access.js";

type AiFileAccessPolicyProvider = () => AiFileAccessPolicy;
```

Change factory signatures:

```ts
export function createReadFileTool(
  projectRoot: string,
  getAiFileAccessPolicy: AiFileAccessPolicyProvider = () => createAiFileAccessPolicy(projectRoot, []),
): AgentTool<typeof ReadFileParams> {
```

Use the same provider pattern for `createListFilesTool`, `createSearchContentTool`, `createRenderCardTool`, and `createEditFileTool`. Import `createAiFileAccessPolicy` where needed for the default provider.

- [ ] **Step 4: Add denial checks in read-like tools**

Use this pattern before file reads or listings:

```ts
try {
  getAiFileAccessPolicy().assertReadableByAi(params.path);
} catch (err) {
  return {
    content: [{ type: "text" as const, text: (err as Error).message }],
    details: { path: params.path, denied: true },
  };
}
```

For recursive traversal in `list-files.ts` and `search-content.ts`, skip entries whose relative path is denied. For `list_files`, compute child relative paths and do not push denied entries. For `search_content`, do not recurse into denied directories and do not read denied files.

- [ ] **Step 5: Update `createToolsForProject()`**

Modify `packages/core/src/tools/index.ts` signature:

```ts
import type { AiFileAccessPolicy } from "../access/ai-file-access.js";

type AiFileAccessPolicyProvider = () => AiFileAccessPolicy;

export function createToolsForProject(
  projectRoot: string,
  mutex: FileWriteMutex,
  changelogPath?: string,
  skillDir?: string,
  getAiFileAccessPolicy?: AiFileAccessPolicyProvider,
): Record<string, AgentTool<any>> {
```

Pass `getAiFileAccessPolicy` to `read_file`, `edit_file`, `list_files`, `search_content`, and `render_card`.

- [ ] **Step 6: Update `readContextFiles()`**

Modify `packages/core/src/engine/read-context-files.ts`:

```ts
import type { AiFileAccessPolicy } from "../access/ai-file-access.js";

export async function readContextFiles(
  projectRoot: string,
  contextPaths: string[] | undefined,
  getAiFileAccessPolicy?: () => AiFileAccessPolicy,
): Promise<string> {
```

Before `fs.readFile`, skip denied paths:

```ts
      if (getAiFileAccessPolicy?.().isDenied(relPath)) {
        continue;
      }
```

- [ ] **Step 7: Wire dynamic policy in Engine**

Modify `packages/core/src/engine.ts` imports:

```ts
import { createAiFileAccessPolicy } from "./access/ai-file-access.js";
```

Inside `buildAgent()`, create a dynamic provider after `projectRoot` is available:

```ts
    const getAiFileAccessPolicy = () => createAiFileAccessPolicy(
      projectRoot,
      this.projectStore.getAiAccessSettings().deniedPaths,
    );
```

Pass it to `createToolsForProject()` and `readContextFiles()` so active agents read the latest `ProjectStore` config for subsequent tool calls.

- [ ] **Step 8: Run targeted core tests and verify pass**

Run: `npm test --workspace=packages/core -- read-file list-files search-content render-card edit-file read-context-files`

Expected: PASS for affected tool and context tests.

## Task 4: Server And Renderer API

**Files:**
- Modify: `packages/server/src/routes/settings.ts`
- Modify: `packages/app/src/lib/api.ts`

- [ ] **Step 1: Add settings routes**

Modify `packages/server/src/routes/settings.ts`:

```ts
export function registerSettingsRoutes(fastify: FastifyInstance, ctx: AppContext): void {
  fastify.get("/api/settings/providers", async () => {
    return getSupportedProviders();
  });

  fastify.get("/api/settings/ai-access", async () => {
    return ctx.projectStore.getAiAccessSettings();
  });

  fastify.put<{ Body: { deniedPaths: string[] } }>(
    "/api/settings/ai-access",
    async (req, reply) => {
      if (!Array.isArray(req.body?.deniedPaths)) {
        return reply.code(400).send({ error: "Missing or invalid 'deniedPaths'" });
      }
      try {
        const settings = await ctx.projectStore.updateAiAccessSettings(req.body.deniedPaths);
        return { ok: true, ...settings };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
```

- [ ] **Step 2: Add renderer API client methods**

Modify `packages/app/src/lib/api.ts`:

```ts
    async getAiAccessSettings(): Promise<{ deniedPaths: string[] }> {
      const res = await fetch(`${baseUrl}/api/settings/ai-access`);
      if (!res.ok) return { deniedPaths: [] };
      return res.json();
    },

    async updateAiAccessSettings(deniedPaths: string[]): Promise<{ ok: boolean; deniedPaths: string[] }> {
      const res = await fetch(`${baseUrl}/api/settings/ai-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deniedPaths }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },
```

- [ ] **Step 3: Run server/app type checks through tests**

Run: `npm test --workspace=packages/app`

Expected: PASS or no failures introduced by `ApiClient` type changes.

Run: `npm run build --workspace=packages/server`

Expected: exit 0.

## Task 5: File Tree Dialog UI

**Files:**
- Create: `packages/app/src/features/file-tree/useAiReadDenylist.ts`
- Create: `packages/app/src/features/file-tree/useAiReadDenylist.test.ts`
- Create: `packages/app/src/features/file-tree/AiReadDenylistDialog.tsx`
- Modify: `packages/app/src/features/project-panel/index.tsx`

- [ ] **Step 1: Implement denylist hook**

Create `packages/app/src/features/file-tree/useAiReadDenylist.ts`:

```ts
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ApiClient } from "../../lib/api";

export function normalizeAiDeniedPath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (
    normalized === "AGENTS.md" ||
    normalized === "CHANGELOG.md" ||
    normalized === ".spherse" ||
    normalized.startsWith(".spherse/")
  ) {
    return null;
  }
  return normalized;
}

export function useAiReadDenylist(client: ApiClient, open: boolean) {
  const [paths, setPaths] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    client
      .getAiAccessSettings()
      .then((settings) => setPaths(settings.deniedPaths))
      .catch((err: unknown) => toast.error(`读取 AI 读取限制失败：${(err as Error).message}`))
      .finally(() => setLoading(false));
  }, [client, open]);

  const addInput = () => {
    const normalized = normalizeAiDeniedPath(input);
    if (!normalized) {
      toast.error("路径无效或不可加入限制列表");
      return;
    }
    if (paths.includes(normalized)) {
      toast.error("路径已存在");
      return;
    }
    setPaths((current) => [...current, normalized]);
    setInput("");
  };

  const removePath = (path: string) => {
    setPaths((current) => current.filter((item) => item !== path));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await client.updateAiAccessSettings(paths);
      setPaths(result.deniedPaths);
      toast.success("AI 读取限制已保存");
      return true;
    } catch (err) {
      toast.error(`保存失败：${(err as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { paths, input, saving, loading, setInput, addInput, removePath, save };
}
```

- [ ] **Step 2: Implement dialog component**

Create `packages/app/src/features/file-tree/AiReadDenylistDialog.tsx`:

```tsx
import type { KeyboardEvent } from "react";
import { Trash2Icon } from "lucide-react";
import type { ApiClient } from "../../lib/api";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { useAiReadDenylist } from "./useAiReadDenylist";

export function AiReadDenylistDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ApiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const denylist = useAiReadDenylist(client, open);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      denylist.addInput();
    }
  };

  const handleSave = async () => {
    const saved = await denylist.save();
    if (saved) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>AI 读取限制</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            列表中的文件或目录不会被 AI 工具读取；你仍可正常查看和编辑。
          </p>
          <div className="flex gap-2">
            <Input
              value={denylist.input}
              onChange={(event) => denylist.setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例如 secrets 或 notes/private.md"
            />
            <Button type="button" onClick={denylist.addInput}>
              添加
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            {denylist.loading ? (
              <p className="p-3 text-sm text-muted-foreground">加载中...</p>
            ) : denylist.paths.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">暂无限制路径</p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {denylist.paths.map((path) => (
                  <div key={path} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{path}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`移除 ${path}`}
                      onClick={() => denylist.removePath(path)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={handleSave} disabled={denylist.saving}>
            {denylist.saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Add hook tests**

Create `packages/app/src/features/file-tree/useAiReadDenylist.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeAiDeniedPath } from "./useAiReadDenylist";

describe("normalizeAiDeniedPath", () => {
  it("normalizes valid relative paths", () => {
    expect(normalizeAiDeniedPath(" secrets\\key.md ")).toBe("secrets/key.md");
    expect(normalizeAiDeniedPath("./notes/private.md")).toBe("notes/private.md");
  });

  it("rejects invalid and reserved paths", () => {
    expect(normalizeAiDeniedPath("")).toBeNull();
    expect(normalizeAiDeniedPath("../secret.md")).toBeNull();
    expect(normalizeAiDeniedPath("/secret.md")).toBeNull();
    expect(normalizeAiDeniedPath("AGENTS.md")).toBeNull();
    expect(normalizeAiDeniedPath("CHANGELOG.md")).toBeNull();
    expect(normalizeAiDeniedPath(".spherse/project.yaml")).toBeNull();
  });
});
```

- [ ] **Step 4: Add ProjectPanel header button**

Modify `packages/app/src/features/project-panel/index.tsx`:

```tsx
import { useState } from "react";
import { SettingsIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { AiReadDenylistDialog } from "../file-tree/AiReadDenylistDialog";
```

Inside `ProjectPanel`:

```tsx
  const [aiDenylistOpen, setAiDenylistOpen] = useState(false);
```

Replace the file label block with:

```tsx
            <div className="flex h-7 items-center justify-between gap-2">
              <SidebarGroupLabel className="h-7 px-0 text-[11px] font-semibold tracking-wide uppercase">
                文件
              </SidebarGroupLabel>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="设置 AI 文件读取限制"
                onClick={() => setAiDenylistOpen(true)}
              >
                <SettingsIcon className="size-4" />
              </Button>
            </div>
```

Render the dialog near the `FileTree`:

```tsx
              <AiReadDenylistDialog
                client={project.ctx.client}
                open={aiDenylistOpen}
                onOpenChange={setAiDenylistOpen}
              />
```

- [ ] **Step 5: Run app tests**

Run: `npm test --workspace=packages/app`

Expected: PASS.

## Task 6: Documentation Sync

**Files:**
- Modify: `docs/official/architecture.md`
- Modify: `docs/official/data-conventions.md`

- [ ] **Step 1: Update architecture docs**

In `docs/official/architecture.md`, add to Core layer bullets:

```md
- **AI 文件读取限制**：项目配置可声明 `aiAccess.deniedPaths`；Engine 构建 agent 时通过动态 access policy 限制 `read_file`、`list_files`、`search_content`、`render_card file_path`、`edit_file` 的内部读取和 profile context 注入。
```

Add to Server layer bullets:

```md
- **AI access settings API**：`settings.ts` 暴露 `/api/settings/ai-access`，读写项目级 AI 读取禁止列表；renderer 不直接通过 content API 编辑 `.spherse/project.yaml`。
```

Replace the feature-based organization bullet so it includes `features/file-tree`:

```md
- **feature-based 组织**：`features/chat`、`features/content-browser`、`features/agent-session-list`、`features/project-panel`、`features/file-tree`、`features/text-selection-session`、`features/settings`、`features/debug-tools`、`features/activity-bar` 分别拥有自己的组件和 hooks
```

- [ ] **Step 2: Update data conventions docs**

In `docs/official/data-conventions.md`, add or update a `ProjectConfig` section with:

```md
## ProjectConfig

`.spherse/project.yaml` 保存项目级配置。`aiAccess.deniedPaths` 是项目相对路径数组，用于限制 AI 工具读取文件内容或暴露目录内容。路径使用 `/` 分隔，不允许路径穿越，不允许加入 `AGENTS.md`、`CHANGELOG.md`、`.spherse` 或 `.spherse/**`。
```

- [ ] **Step 3: Verify docs can be read**

Run: `npm run lint`

Expected: exit 0.

## Task 7: Full Verification

**Files:**
- No new files unless earlier verification reveals issues.

- [ ] **Step 1: Run core tests**

Run: `npm test --workspace=packages/core`

Expected: all core tests pass.

- [ ] **Step 2: Run app tests**

Run: `npm test --workspace=packages/app`

Expected: all app tests pass.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 4: Inspect working tree**

Run: `git status --short`

Expected: modified and created files are limited to this feature and documentation. Do not commit unless the user explicitly asks.
