# 用户自定义欢迎页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户为每个项目设置一个 HTML/图片欢迎页，并在 Chat 页面提供关闭按钮回到欢迎页。

**Architecture:** 在 `ProjectConfig` 中新增 `welcomePage` 字段，通过 `ProjectStore` 校验和持久化到 `.spherse/project.yaml`。Server 暴露专用 settings API，renderer 通过 `ApiClient` 读写。前端在项目头像右键菜单加入口，`ProjectLayout` 在根路由渲染欢迎页，Chat Header 新增关闭按钮。

**Tech Stack:** TypeScript (ESM / Node16), React, Zustand, Fastify, YAML, shadcn/ui, Tailwind CSS v4, @spherse/i18n

---

### Task 1: Core — 类型定义与路径校验

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/store/project.ts`

- [ ] **Step 1: 在 `ProjectConfig` 中新增 `welcomePage` 可选字段**

在 `packages/core/src/types.ts` 的 `ProjectConfig` 接口中，在 `aiAccess` 之后添加：

```ts
  welcomePage?: {
    path: string;
  };
```

- [ ] **Step 2: 在 `ProjectStore` 中新增路径校验辅助函数和两个方法**

在 `packages/core/src/store/project.ts` 中：

1. 在文件顶部（class 外部）新增常量和校验函数：

```ts
const WELCOME_PAGE_EXTENSIONS = new Set(["html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg"]);

function normalizeWelcomePagePath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized) return null;
  if (normalized === ".spherse" || normalized.startsWith(".spherse/")) return null;
  const ext = normalized.split(".").pop()?.toLowerCase();
  if (!ext || !WELCOME_PAGE_EXTENSIONS.has(ext)) return null;
  return normalized;
}
```

2. 在 `ProjectStore` class 中新增两个方法（放在 `getAiAccessSettings` 之后、`getRootPath` 之前）：

```ts
  getWelcomePageSettings(): { path: string | null } {
    return { path: this.config?.welcomePage?.path ?? null };
  }

  async updateWelcomePageSettings(
    welcomePath: string | null,
  ): Promise<{ path: string | null }> {
    if (!this.config) {
      throw new Error("Project is not open");
    }

    if (welcomePath !== null) {
      const normalized = normalizeWelcomePagePath(welcomePath);
      if (!normalized) {
        throw new Error(`Invalid welcome page path: ${welcomePath}`);
      }
      const nextConfig = { ...this.config, welcomePage: { path: normalized } };
      const configPath = path.join(this.spherseDir, "project.yaml");
      await fs.writeFile(configPath, YAML.stringify(nextConfig), "utf-8");
      this.config = nextConfig;
      return { path: normalized };
    }

    const { welcomePage: _, ...rest } = this.config;
    const nextConfig = rest as ProjectConfig;
    const configPath = path.join(this.spherseDir, "project.yaml");
    await fs.writeFile(configPath, YAML.stringify(nextConfig), "utf-8");
    this.config = nextConfig;
    return { path: null };
  }
```

- [ ] **Step 3: 运行构建验证 core 编译通过**

Run: `npm run build --workspace=packages/core`
Expected: 编译成功，无类型错误

---

### Task 2: Core — 单元测试

**Files:**
- Modify: `packages/core/src/__tests__/store/project.test.ts`

- [ ] **Step 1: 在 `project.test.ts` 末尾（最后一个 `it` 之后、`describe` 闭合之前）新增 welcome page 测试**

```ts
  it("has null default welcome page settings after create", async () => {
    await store.create("TestProject", "gemini-2.5-pro");
    expect(store.getWelcomePageSettings()).toEqual({ path: null });
  });

  it("saves, persists, and reopens welcome page settings", async () => {
    await store.create("TestProject", "gemini-2.5-pro");

    const result = await store.updateWelcomePageSettings("welcome.html");

    expect(result).toEqual({ path: "welcome.html" });
    expect(store.getWelcomePageSettings()).toEqual({ path: "welcome.html" });
    expect(await readFile(projectRoot, ".spherse/project.yaml")).toContain("welcomePage");

    const store2 = new ProjectStore(projectRoot, pino({ level: "silent" }));
    await store2.open();
    expect(store2.getWelcomePageSettings()).toEqual({ path: "welcome.html" });
  });

  it("saves image path as welcome page", async () => {
    await store.create("TestProject", "gemini-2.5-pro");

    const result = await store.updateWelcomePageSettings("assets/banner.png");

    expect(result).toEqual({ path: "assets/banner.png" });
  });

  it("clears welcome page settings with null", async () => {
    await store.create("TestProject", "gemini-2.5-pro");
    await store.updateWelcomePageSettings("welcome.html");

    const result = await store.updateWelcomePageSettings(null);

    expect(result).toEqual({ path: null });
    expect(store.getWelcomePageSettings()).toEqual({ path: null });
  });

  it("rejects invalid welcome page paths", async () => {
    await store.create("TestProject", "gemini-2.5-pro");

    for (const invalidPath of ["", ".", "../evil.html", "/absolute.html", ".spherse/x.html"]) {
      await expect(store.updateWelcomePageSettings(invalidPath)).rejects.toThrow(
        `Invalid welcome page path: ${invalidPath}`,
      );
    }

    expect(store.getWelcomePageSettings()).toEqual({ path: null });
  });

  it("rejects unsupported file extensions", async () => {
    await store.create("TestProject", "gemini-2.5-pro");

    await expect(store.updateWelcomePageSettings("readme.md")).rejects.toThrow(
      "Invalid welcome page path: readme.md",
    );
    await expect(store.updateWelcomePageSettings("data.json")).rejects.toThrow(
      "Invalid welcome page path: data.json",
    );

    expect(store.getWelcomePageSettings()).toEqual({ path: null });
  });

  it("throws when updating welcome page settings before create or open", async () => {
    await expect(store.updateWelcomePageSettings("welcome.html")).rejects.toThrow(
      "Project is not open",
    );
  });
```

- [ ] **Step 2: 运行测试验证全部通过**

Run: `npm test --workspace=packages/core`
Expected: 所有测试 PASS（含原有和新增）

---

### Task 3: Server — 欢迎页 Settings API

**Files:**
- Modify: `packages/server/src/routes/settings.ts`

- [ ] **Step 1: 在 `registerSettingsRoutes` 末尾（`put("/api/settings/ai-access"...)` 之后）新增两个路由**

```ts
  fastify.get("/api/settings/welcome-page", async () => {
    return ctx.projectStore.getWelcomePageSettings();
  });

  fastify.put<{ Body: { path: string | null } }>(
    "/api/settings/welcome-page",
    async (req, reply) => {
      if (req.body && typeof req.body.path !== "string" && req.body.path !== null) {
        return reply.code(400).send({ error: "Missing or invalid 'path'" });
      }
      try {
        const settings = await ctx.projectStore.updateWelcomePageSettings(req.body?.path ?? null);
        return { ok: true, ...settings };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
```

- [ ] **Step 2: 构建 server 验证编译通过**

Run: `npm run build --workspace=packages/server`
Expected: 编译成功

---

### Task 4: App — API Client 新增方法

**Files:**
- Modify: `packages/app/src/lib/api.ts`

- [ ] **Step 1: 在 `updateAiAccessSettings` 方法之后、`createChatWebSocket` 之前，新增两个方法**

```ts
    async getWelcomePageSettings(): Promise<{ path: string | null }> {
      const res = await fetch(`${baseUrl}/api/settings/welcome-page`);
      if (!res.ok) return { path: null };
      return res.json();
    },

    async updateWelcomePageSettings(path: string | null): Promise<{ ok: boolean; path: string | null }> {
      const res = await fetch(`${baseUrl}/api/settings/welcome-page`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },
```

- [ ] **Step 2: 验证 app 编译通过**

Run: `npm run build --workspace=packages/app`
Expected: 编译成功（可能需要先 build core 和 server）

---

### Task 5: i18n — 新增文案

**Files:**
- Modify: `packages/i18n/src/locales/zh-CN.ts`
- Modify: `packages/i18n/src/locales/zh-TW.ts`
- Modify: `packages/i18n/src/locales/en.ts`

- [ ] **Step 1: 在 `zh-CN.ts` 的 `// --- Chat ---` 区块末尾（`"chat.copyTooltip"` 之后）添加**

```ts
  // Chat 关闭按钮悬停提示
  "chat.close": "关闭",
```

在 `// --- Activity Bar ---` 区块末尾（`"activity-bar.revealInFinder"` 之后）添加：

```ts
  // 项目右键菜单：设置欢迎页
  "activity-bar.setWelcomePage": "设置欢迎页",
```

在 `"settings.language"` 之后添加欢迎页设置相关文案：

```ts
  // --- Welcome Page Settings ---
  // 欢迎页设置弹窗标题
  "welcome-page-settings.title": "设置欢迎页",
  // 欢迎页设置弹窗说明
  "welcome-page-settings.description": "选择项目内 HTML 文件或图片作为项目欢迎页。",
  // 欢迎页路径输入框标签
  "welcome-page-settings.pathLabel": "文件路径",
  // 欢迎页路径输入框占位提示
  "welcome-page-settings.pathPlaceholder": "例如 welcome.html 或 assets/banner.png",
  // 欢迎页清除按钮
  "welcome-page-settings.clear": "清除",
  // 欢迎页路径无效时的提示
  "welcome-page-settings.invalidPath": "路径无效，请使用项目内相对路径并确保文件扩展名为 HTML 或图片格式",
  // 欢迎页保存成功提示
  "welcome-page-settings.saved": "欢迎页已保存",
  // 欢迎页保存失败提示，{message} 为错误信息
  "welcome-page-settings.saveFailed": "保存失败：{message}",
  // 欢迎页读取失败提示，{message} 为错误信息
  "welcome-page-settings.loadFailed": "读取欢迎页设置失败：{message}",
```

在 `"error.requestFailed"` 之前添加欢迎页渲染相关文案：

```ts
  // --- Welcome Page ---
  // 欢迎页文件不存在时的提示
  "welcome-page.fileMissing": "欢迎页文件不存在：{path}",
  // 欢迎页加载失败时的提示
  "welcome-page.loadFailed": "欢迎页加载失败",
```

- [ ] **Step 2: 在 `zh-TW.ts` 对应位置添加相同 key 的繁体翻译**

在 `"chat.copyTooltip"` 之后添加：

```ts
  "chat.close": "關閉",
```

在 `"activity-bar.revealInFinder"` 之后添加：

```ts
  "activity-bar.setWelcomePage": "設定歡迎頁",
```

在 `"settings.language"` 之后添加：

```ts
  "welcome-page-settings.title": "設定歡迎頁",
  "welcome-page-settings.description": "選擇專案內 HTML 檔案或圖片作為專案歡迎頁。",
  "welcome-page-settings.pathLabel": "檔案路徑",
  "welcome-page-settings.pathPlaceholder": "例如 welcome.html 或 assets/banner.png",
  "welcome-page-settings.clear": "清除",
  "welcome-page-settings.invalidPath": "路徑無效，請使用專案內相對路徑並確保副檔名為 HTML 或圖片格式",
  "welcome-page-settings.saved": "歡迎頁已儲存",
  "welcome-page-settings.saveFailed": "儲存失敗：{message}",
  "welcome-page-settings.loadFailed": "讀取歡迎頁設定失敗：{message}",
```

在 `"error.requestFailed"` 之前添加：

```ts
  "welcome-page.fileMissing": "歡迎頁檔案不存在：{path}",
  "welcome-page.loadFailed": "歡迎頁載入失敗",
```

- [ ] **Step 3: 在 `en.ts` 对应位置添加英文翻译**

在 `"chat.copyTooltip"` 之后添加：

```ts
  "chat.close": "Close",
```

在 `"activity-bar.revealInFinder"` 之后添加：

```ts
  "activity-bar.setWelcomePage": "Set Welcome Page",
```

在 `"settings.language"` 之后添加：

```ts
  "welcome-page-settings.title": "Set Welcome Page",
  "welcome-page-settings.description": "Select an HTML file or image in the project as the welcome page.",
  "welcome-page-settings.pathLabel": "File Path",
  "welcome-page-settings.pathPlaceholder": "e.g. welcome.html or assets/banner.png",
  "welcome-page-settings.clear": "Clear",
  "welcome-page-settings.invalidPath": "Invalid path. Use a project-relative path with an HTML or image extension.",
  "welcome-page-settings.saved": "Welcome page saved",
  "welcome-page-settings.saveFailed": "Save failed: {message}",
  "welcome-page-settings.loadFailed": "Failed to load welcome page settings: {message}",
```

在 `"error.requestFailed"` 之前添加：

```ts
  "welcome-page.fileMissing": "Welcome page file not found: {path}",
  "welcome-page.loadFailed": "Failed to load welcome page",
```

- [ ] **Step 4: 运行 i18n 校验**

Run: `npm run check:i18n --workspace=packages/i18n`
Expected: 通过，三个 locale key 一致

---

### Task 6: App — 欢迎页设置 Dialog

**Files:**
- Create: `packages/app/src/features/welcome-page-settings/index.tsx`

- [ ] **Step 1: 创建 `packages/app/src/features/welcome-page-settings/` 目录**

Run: `mkdir -p packages/app/src/features/welcome-page-settings`

- [ ] **Step 2: 创建 `packages/app/src/features/welcome-page-settings/index.tsx`**

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { translate, useI18n } from "@spherse/i18n";
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
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { useSettingsStore } from "../settings/store";

const WELCOME_PAGE_EXTENSIONS = new Set(["html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg"]);

function normalizeWelcomePagePath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized) return null;
  if (normalized === ".spherse" || normalized.startsWith(".spherse/")) return null;
  const ext = normalized.split(".").pop()?.toLowerCase();
  if (!ext || !WELCOME_PAGE_EXTENSIONS.has(ext)) return null;
  return normalized;
}

export function WelcomePageSettingsDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ApiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [path, setPath] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const locale = useSettingsStore.getState().locale ?? "zh-CN";
    setLoading(true);
    client
      .getWelcomePageSettings()
      .then((settings) => {
        setSavedPath(settings.path);
        setPath(settings.path ?? "");
      })
      .catch((err: unknown) =>
        toast.error(translate(locale, "welcome-page-settings.loadFailed", { message: (err as Error).message })),
      )
      .finally(() => setLoading(false));
  }, [client, open]);

  const handleSave = async () => {
    const locale = useSettingsStore.getState().locale ?? "zh-CN";
    const trimmed = path.trim();
    const valueToSave = trimmed === "" ? null : trimmed;

    if (valueToSave !== null) {
      const normalized = normalizeWelcomePagePath(valueToSave);
      if (!normalized) {
        toast.error(translate(locale, "welcome-page-settings.invalidPath"));
        return;
      }
    }

    setSaving(true);
    try {
      const result = await client.updateWelcomePageSettings(valueToSave);
      setSavedPath(result.path);
      toast.success(translate(locale, "welcome-page-settings.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(translate(locale, "welcome-page-settings.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    const locale = useSettingsStore.getState().locale ?? "zh-CN";
    setSaving(true);
    try {
      const result = await client.updateWelcomePageSettings(null);
      setSavedPath(result.path);
      setPath("");
      toast.success(translate(locale, "welcome-page-settings.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(translate(locale, "welcome-page-settings.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("welcome-page-settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("welcome-page-settings.description")}
          </p>
          <FieldGroup>
            <Field>
              <FieldLabel>{t("welcome-page-settings.pathLabel")}</FieldLabel>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t("welcome-page-settings.pathPlaceholder")}
              />
            </Field>
          </FieldGroup>
        </div>
        <DialogFooter>
          {savedPath && (
            <Button type="button" variant="outline" onClick={handleClear} disabled={saving} className="mr-auto">
              {t("welcome-page-settings.clear")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

### Task 7: App — 欢迎页渲染组件

**Files:**
- Create: `packages/app/src/features/welcome-page/index.tsx`

- [ ] **Step 1: 创建 `packages/app/src/features/welcome-page/` 目录**

Run: `mkdir -p packages/app/src/features/welcome-page`

- [ ] **Step 2: 创建 `packages/app/src/features/welcome-page/index.tsx`**

```tsx
import { useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { ApiClient } from "../../lib/api";

const HTML_EXTENSIONS = new Set(["html", "htm"]);

function getFileExtension(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}

export function WelcomePage({
  client,
  path,
}: {
  client: ApiClient;
  path: string;
}) {
  const { t } = useI18n();
  const [loadError, setLoadError] = useState(false);
  const ext = getFileExtension(path);
  const isHtml = HTML_EXTENSIONS.has(ext);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{t("welcome-page.loadFailed")}</p>
      </div>
    );
  }

  if (isHtml) {
    return (
      <iframe
        src={client.getPreviewUrl(path)}
        className="flex-1 w-full border-0"
        title="Welcome Page"
        sandbox="allow-scripts allow-same-origin"
        onError={() => setLoadError(true)}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <img
        src={client.getPreviewUrl(path)}
        alt="Welcome Page"
        className="max-h-full max-w-full object-contain"
        onError={() => setLoadError(true)}
      />
    </div>
  );
}
```

---

### Task 8: App — ActivityBar 右键菜单入口 + App.tsx Dialog 管理

**Files:**
- Modify: `packages/app/src/features/activity-bar/index.tsx`
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: 修改 `ActivityBarProps` 接口，新增 `onWelcomePageSettings`**

在 `packages/app/src/features/activity-bar/index.tsx` 的 `ActivityBarProps` 中，在 `onSettings` 之后添加：

```ts
  onWelcomePageSettings: (projectKey: string) => void;
```

在函数参数解构中添加 `onWelcomePageSettings`。

在右键菜单 `<ContextMenuContent>` 中，在 `"activity-bar.revealInFinder"` 的 `ContextMenuItem` 之后添加：

```tsx
              <ContextMenuItem onClick={() => onWelcomePageSettings(projectKey)}>
                {t("activity-bar.setWelcomePage")}
              </ContextMenuItem>
```

- [ ] **Step 2: 修改 `App.tsx`，管理欢迎页设置 dialog 状态**

1. 新增 import：

```ts
import { WelcomePageSettingsDialog } from "./features/welcome-page-settings";
```

2. 在 `App` 函数内，`const [showSettings, setShowSettings] = useState(false);` 之后添加：

```ts
  const [welcomePageSettingsProjectKey, setWelcomePageSettingsProjectKey] = useState<string | null>(null);
```

3. 在 `ActivityBar` 组件调用中，在 `onSettings={() => setShowSettings(true)}` 之后添加 prop：

```tsx
            onWelcomePageSettings={(projectKey) => setWelcomePageSettingsProjectKey(projectKey)}
```

4. 在 `{showSettings && <SettingsModal ... />}` 之后、`<Toaster />` 之前添加：

```tsx
          {welcomePageSettingsProjectKey && (() => {
            const project = projects.get(welcomePageSettingsProjectKey);
            if (!project) return null;
            return (
              <WelcomePageSettingsDialog
                key={welcomePageSettingsProjectKey}
                client={project.ctx.client}
                open={true}
                onOpenChange={(open) => { if (!open) setWelcomePageSettingsProjectKey(null); }}
              />
            );
          })()}
```

---

### Task 9: App — Chat 关闭按钮

**Files:**
- Modify: `packages/app/src/features/chat/Header.tsx`
- Modify: `packages/app/src/features/chat/index.tsx`
- Modify: `packages/app/src/layouts/ProjectLayout.tsx`

- [ ] **Step 1: 修改 `Header.tsx`，接收 `onClose` prop 并显示关闭按钮**

将 `HeaderProps` 和 `Header` 改为：

```tsx
import type { AgentProfile } from "../../lib/types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { XIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";

interface HeaderProps {
  agent: AgentProfile;
  onClose?: () => void;
}

export function Header({ agent, onClose }: HeaderProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-3">
      <span className="font-semibold text-[15px]">{agent.name}</span>
      <Badge variant="secondary">{agent.type}</Badge>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={onClose}
          title={t("chat.close")}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 修改 `Chat` 组件，接收 `onClose` 并处理 streaming abort**

在 `ChatProps` 中添加 `onClose`：

```ts
  onClose?: () => void;
```

修改 `Chat` 函数，在 `useChatScroll` 之后、return 之前添加 `handleClose`：

```ts
  const handleClose = () => {
    if (streaming) abort();
    onClose?.();
  };
```

修改 `<Header>` 调用：

```tsx
      <Header agent={agent} onClose={onClose ? handleClose : undefined} />
```

- [ ] **Step 3: 修改 `ProjectLayout.tsx`，向 `Chat` 传入 `onClose`**

在 `<Chat>` 调用中添加 `onClose` prop：

```tsx
            <Chat
              key={selectedSession.id}
              client={project.ctx.client}
              sessionId={selectedSession.id}
              agent={selectedAgent}
              onNavigateToPath={handleSelectFile}
              initialMessage={initialMessage}
              onClose={() => navigate(`/project/${projectKey}`)}
            />
```

---

### Task 10: App — ProjectLayout 欢迎页渲染

**Files:**
- Modify: `packages/app/src/layouts/ProjectLayout.tsx`

- [ ] **Step 1: 新增 import 和欢迎页加载逻辑**

1. 修改文件顶部的 import，在 `{ useEffect }` 中添加 `useState`：

```ts
import { useEffect, useState } from "react";
```

添加欢迎页组件 import：

```ts
import { WelcomePage } from "../features/welcome-page";
```

2. 在 `useCustomTheme` 之后（`const initialMessage = ...` 之后），添加欢迎页加载 state 和 effect：

```ts
  const [welcomePagePath, setWelcomePagePath] = useState<string | null>(null);

  useEffect(() => {
    project.ctx.client.getWelcomePageSettings().then((settings) => {
      setWelcomePagePath(settings.path);
    });
  }, [project.ctx.client]);
```

3. 替换原有的空状态渲染块。将：

```tsx
        {!showingContent && !(selectedSession && selectedAgent) && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p>{t("chat.startConversation")}</p>
          </div>
        )}
```

替换为：

```tsx
        {!showingContent && !(selectedSession && selectedAgent) && (
          welcomePagePath ? (
            <WelcomePage client={project.ctx.client} path={welcomePagePath} />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <p>{t("chat.startConversation")}</p>
            </div>
          )
        )}
```

---

### Task 11: 全量构建与测试验证

- [ ] **Step 1: 构建 core、server、app**

Run: `npm run build`
Expected: 全量构建成功

- [ ] **Step 2: 运行 core 单测**

Run: `npm test --workspace=packages/core`
Expected: 所有测试 PASS

- [ ] **Step 3: 运行 app 单测**

Run: `npm test --workspace=packages/app`
Expected: 所有测试 PASS

- [ ] **Step 4: 运行 i18n 校验**

Run: `npm run check:i18n --workspace=packages/i18n`
Expected: 通过

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`
Expected: 无错误
