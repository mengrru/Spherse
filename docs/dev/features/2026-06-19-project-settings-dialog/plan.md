# 项目设置子菜单 + 主题编辑器 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将项目头像右键菜单的「设置欢迎页」改为二级菜单「设置」（含「欢迎页」「主题」），新增主题 CSS 编辑器 Dialog 与 `GET/PUT /settings/theme` 端点。

**Architecture:** 二级菜单 + 各自独立 Dialog（数据流隔离）。welcome-page 零改动（仅从顶级菜单移入二级子菜单）。后端纯增量——只新增 theme 端点，不重构现有路由。

**Tech Stack:** TypeScript (ESM), Fastify, TypeBox contracts, React, Tailwind CSS v4, @spherse/i18n。

**Design doc:** `docs/dev/features/2026-06-19-project-settings-dialog/design.md`

---

## 文件结构

### 新建
- `packages/app/src/features/theme-settings/index.tsx` — `ThemeSettingsDialog` 组件（CSS 文本编辑器 Dialog）

### 修改
- `packages/server/src/contracts/settings.ts` — 新增 `themeSettingsRequest` / `themeSettingsResponse` schema + 类型
- `packages/server/src/contracts/index.ts` — 导出新类型
- `packages/server/src/routes/settings.ts` — 新增 `GET/PUT /settings/theme` 路由
- `packages/server/src/__tests__/contracts/api-contracts.test.ts` — 新增 theme contract 测试
- `packages/app/src/lib/types.ts` — re-export `ThemeSettingsResponse`
- `packages/app/src/lib/api.ts` — 新增 `getThemeSettings` / `updateThemeSettings`
- `packages/app/src/lib/events.ts` — 新增 `THEME_SETTINGS_CHANGED_EVENT`
- `packages/app/src/hooks/useCustomTheme.ts` — 监听 theme 事件热更新
- `packages/app/src/features/activity-bar/index.tsx` — 菜单改二级菜单 + 挂载 ThemeSettingsDialog
- `packages/i18n/src/locales/zh-CN.ts` / `zh-TW.ts` / `en.ts` — 改菜单文案 + 新增 theme-settings 文案
- `docs/official/project-structure.md` / `architecture.md` / `docs/dev/backlog.md` — 文档同步

### 不动
- `packages/app/src/features/welcome-page-settings/` — 完全不动
- 现有 `GET/PUT /settings/welcome-page` 路由 — 完全不动

---

## Task 1: Backend contract schema

**Files:**
- Modify: `packages/server/src/contracts/settings.ts`
- Modify: `packages/server/src/contracts/index.ts`

- [ ] **Step 1: 在 `contracts/settings.ts` 的 `schemas` 对象中新增 theme schema**

在 `welcomePageSettingsResponse` 之后、`}` 闭合之前新增：

```ts
  themeSettingsRequest: Type.Object({
    content: Type.String(),
  }),
  themeSettingsResponse: Type.Object({
    ok: Type.Boolean(),
    content: Type.String(),
  }),
```

在文件末尾的类型导出区（`WelcomePageSettingsResponse` 之后）新增：

```ts
export type ThemeSettingsRequest = Static<typeof schemas.themeSettingsRequest>;
export type ThemeSettingsResponse = Static<typeof schemas.themeSettingsResponse>;
```

- [ ] **Step 2: 在 `contracts/index.ts` 导出新类型**

在 `WelcomePageSettingsResponse,` 之后新增：

```ts
  ThemeSettingsRequest,
  ThemeSettingsResponse,
```

- [ ] **Step 3: 验证编译**

Run: `npm run build --workspace=packages/server`
Expected: 编译通过，无报错。

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/contracts/settings.ts packages/server/src/contracts/index.ts
git commit -m "feat: add theme settings contract schema"
```

---

## Task 2: Backend theme routes

**Files:**
- Modify: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/__tests__/contracts/api-contracts.test.ts`

- [ ] **Step 1: 在 `settings.ts` 顶部新增 fs/path/resolveProjectPath 导入**

将现有的第 1-4 行：

```ts
import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import { getSupportedProviders } from "@spherse/core";
import { schemas } from "@spherse/server/contracts";
```

改为：

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "../registry.js";
import { getSupportedProviders, resolveProjectPath } from "@spherse/core";
import { schemas } from "@spherse/server/contracts";
```

- [ ] **Step 2: 在 `registerSettingsRoutes` 函数末尾（welcome-page PUT 路由之后、函数闭合 `}` 之前）新增 GET theme 路由**

```ts
  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/settings/theme",
    {
      schema: { response: { 200: schemas.themeSettingsResponse } },
      async handler(req) {
        const root = req.projectCtx!.projectManager.getRootPath();
        const absolutePath = resolveProjectPath(root, ".spherse/theme.css");
        let content = "";
        try {
          content = await fs.readFile(absolutePath, "utf-8");
        } catch {
          content = "";
        }
        return { ok: true, content };
      },
    },
  );
```

- [ ] **Step 3: 紧接 GET theme 之后新增 PUT theme 路由**

```ts
  fastify.put<{ Params: { projectId: string }; Body: { content: string } }>(
    "/api/projects/:projectId/settings/theme",
    {
      schema: {
        body: schemas.themeSettingsRequest,
        response: { 200: schemas.okResponse },
      },
    },
    async (req) => {
      const root = req.projectCtx!.projectManager.getRootPath();
      const absolutePath = resolveProjectPath(root, ".spherse/theme.css");
      await req.projectCtx!.projectManager.getFileWriteMutex().run(absolutePath, async () => {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, req.body.content, "utf-8");
      });
      return { ok: true };
    },
  );
```

- [ ] **Step 4: 在 `api-contracts.test.ts` 的 "validates provider catalog and settings responses" 测试内，welcome-page 断言之后新增 theme contract 断言**

在 `expect(parseApiResponse(schemas.welcomePageSettingsResponse, { ok: true, path: null }))...` 这个断言块之后新增：

```ts
    expect(parseApiResponse(schemas.themeSettingsResponse, { ok: true, content: ":root { --test: #fff; }" })).toEqual({
      ok: true,
      content: ":root { --test: #fff; }",
    });
    expect(() => parseApiResponse(schemas.themeSettingsResponse, { ok: true })).toThrow(/Invalid payload/);
```

- [ ] **Step 5: 运行 contract 测试**

Run: `npm test --workspace=packages/server`
Expected: 全部通过，包括新增的 theme 断言。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/settings.ts packages/server/src/__tests__/contracts/api-contracts.test.ts
git commit -m "feat: add GET/PUT /settings/theme endpoint"
```

---

## Task 3: API client methods

**Files:**
- Modify: `packages/app/src/lib/types.ts`
- Modify: `packages/app/src/lib/api.ts`

- [ ] **Step 1: 在 `types.ts` 的 re-export 块中新增 ThemeSettingsResponse**

将 `WelcomePageSettingsResponse,` 之后新增一行：

```ts
  ThemeSettingsResponse,
```

即 `export type { ... } from "@spherse/server/contracts";` 块中加入 `ThemeSettingsResponse`。

- [ ] **Step 2: 在 `api.ts` 的 import 块中新增 ThemeSettingsResponse**

在第 1-14 行的 `import type { ... } from "./types";` 块中，`WelcomePageSettingsResponse,` 之后新增：

```ts
  ThemeSettingsResponse,
```

- [ ] **Step 3: 在 `api.ts` 中 `updateWelcomePageSettings` 方法之后新增两个 theme client 方法**

在 `updateWelcomePageSettings` 方法结束（`},`）之后、`listSchedules` 方法之前新增：

```ts
    async getThemeSettings(): Promise<ThemeSettingsResponse> {
      const res = await fetch(`${apiBase}/settings/theme`);
      if (!res.ok) return { ok: false, content: "" };
      return parseJsonResponse<ThemeSettingsResponse>(res, schemas.themeSettingsResponse);
    },

    async updateThemeSettings(content: string): Promise<{ ok: boolean }> {
      const res = await fetch(`${apiBase}/settings/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await assertOk(res);
      return parseJsonResponse<{ ok: boolean }>(res, schemas.okResponse);
    },
```

注意：`getThemeSettings` 的 `!res.ok` 降级返回 `{ ok: false, content: "" }`，与现有 `getWelcomePageSettings` 的降级模式一致（参见 `api.ts:253`）。

- [ ] **Step 4: 验证编译**

Run: `npm run build --workspace=packages/app`
Expected: 编译通过。

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/types.ts packages/app/src/lib/api.ts
git commit -m "feat: add theme settings API client methods"
```

---

## Task 4: Theme event + hot-reload hook

**Files:**
- Modify: `packages/app/src/lib/events.ts`
- Modify: `packages/app/src/hooks/useCustomTheme.ts`

- [ ] **Step 1: 在 `events.ts` 新增 THEME_SETTINGS_CHANGED_EVENT**

将文件改为：

```ts
export const WELCOME_PAGE_SETTINGS_CHANGED_EVENT = "spherse:welcome-page-settings-changed";
export const THEME_SETTINGS_CHANGED_EVENT = "spherse:theme-settings-changed";
```

- [ ] **Step 2: 改写 `useCustomTheme.ts` 增加 theme 事件监听**

将整个文件改为：

```ts
import { useEffect } from "react";
import { THEME_SETTINGS_CHANGED_EVENT } from "../lib/events";

export function useCustomTheme(projectRoot: string | undefined, baseUrl: string | undefined, projectId: string | undefined) {
  useEffect(() => {
    if (!projectRoot || !baseUrl || !projectId) return;

    const existingLink = document.getElementById("custom-theme-link");
    if (existingLink) existingLink.remove();

    const link = document.createElement("link");
    link.id = "custom-theme-link";
    link.rel = "stylesheet";
    link.href = `${baseUrl}/api/projects/${projectId}/preview/.spherse/theme.css?t=${Date.now()}`;
    link.onerror = () => {
      link.remove();
    };
    document.head.appendChild(link);

    const handleThemeChange = () => {
      const old = document.getElementById("custom-theme-link");
      if (old) old.remove();
      const fresh = document.createElement("link");
      fresh.id = "custom-theme-link";
      fresh.rel = "stylesheet";
      fresh.href = `${baseUrl}/api/projects/${projectId}/preview/.spherse/theme.css?t=${Date.now()}`;
      fresh.onerror = () => {
        fresh.remove();
      };
      document.head.appendChild(fresh);
    };
    window.addEventListener(THEME_SETTINGS_CHANGED_EVENT, handleThemeChange);

    return () => {
      window.removeEventListener(THEME_SETTINGS_CHANGED_EVENT, handleThemeChange);
    };
  }, [projectRoot, baseUrl, projectId]);
}
```

- [ ] **Step 3: 验证编译**

Run: `npm run build --workspace=packages/app`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/lib/events.ts packages/app/src/hooks/useCustomTheme.ts
git commit -m "feat: add theme hot-reload on settings change"
```

---

## Task 5: ThemeSettingsDialog component

**Files:**
- Create: `packages/app/src/features/theme-settings/index.tsx`

- [ ] **Step 1: 创建 `features/theme-settings/index.tsx`**

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import type { ApiClient } from "../../lib/api";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/textarea";
import { THEME_SETTINGS_CHANGED_EVENT } from "../../lib/events";

export function ThemeSettingsDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ApiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [_loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    client
      .getThemeSettings()
      .then((settings) => {
        setSavedContent(settings.content);
        setContent(settings.content);
      })
      .catch((err: unknown) =>
        toast.error(t("theme-settings.loadFailed", { message: (err as Error).message })),
      )
      .finally(() => setLoading(false));
  }, [client, open, t]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await client.updateThemeSettings(content);
      setSavedContent(content);
      window.dispatchEvent(new Event(THEME_SETTINGS_CHANGED_EVENT));
      toast.success(t("theme-settings.saved"));
    } catch (err) {
      toast.error(t("theme-settings.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("theme-settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("theme-settings.description")}
          </p>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder=":root { --shadcn-primary: #3b82f6; }"
            className="min-h-[240px] font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || content === savedContent}
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 检查 Textarea 组件是否存在，不存在则创建**

Run: `ls packages/app/src/components/ui/textarea.tsx`

如果存在，跳到 Step 3。如果不存在，创建 `packages/app/src/components/ui/textarea.tsx`：

```tsx
import * as React from "react";
import { cn } from "../../lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
```

- [ ] **Step 3: 验证编译**

Run: `npm run build --workspace=packages/app`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/features/theme-settings/ packages/app/src/components/ui/textarea.tsx
git commit -m "feat: add ThemeSettingsDialog component"
```

---

## Task 6: ActivityBar submenu restructure

**Files:**
- Modify: `packages/app/src/features/activity-bar/index.tsx`

- [ ] **Step 1: 更新 import——新增 submenu 组件和 ThemeSettingsDialog**

在 `import { ... } from "../../components/ui/context-menu";` 中新增 `ContextMenuSub`, `ContextMenuSubContent`, `ContextMenuSubTrigger`。

在 `import { WelcomePageSettingsDialog } from "../welcome-page-settings";` 之后新增：

```ts
import { ThemeSettingsDialog } from "../theme-settings";
```

完整 import 块变为（替换原第 6-14 行）：

```ts
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
```

- [ ] **Step 2: 新增 themeSettingsProjectId 状态**

在 `const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);` 之后新增：

```ts
  const [themeSettingsProjectId, setThemeSettingsProjectId] = useState<string | null>(null);
  const themeSettingsProject = themeSettingsProjectId ? projects.get(themeSettingsProjectId) : null;
```

- [ ] **Step 3: 将原 `ContextMenuContent` 中的「设置欢迎页」菜单项替换为二级菜单**

将原（第 81-91 行）：

```tsx
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => setSettingsProjectId(projectId)}>
                      {t("activity-bar.setWelcomePage")}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onReveal(projectId)}>
                      {t("activity-bar.revealInFinder")}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onClose(projectId)}>
                      {t("activity-bar.closeProject")}
                    </ContextMenuItem>
                  </ContextMenuContent>
```

替换为：

```tsx
                  <ContextMenuContent>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        {t("activity-bar.settings")}
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuItem onClick={() => setSettingsProjectId(projectId)}>
                          {t("activity-bar.settings.welcomePage")}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => setThemeSettingsProjectId(projectId)}>
                          {t("activity-bar.settings.theme")}
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem onClick={() => onReveal(projectId)}>
                      {t("activity-bar.revealInFinder")}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onClose(projectId)}>
                      {t("activity-bar.closeProject")}
                    </ContextMenuItem>
                  </ContextMenuContent>
```

- [ ] **Step 4: 在欢迎页 Dialog 挂载之后新增主题 Dialog 挂载**

在原（第 128-135 行）：

```tsx
            {settingsProject && (
              <WelcomePageSettingsDialog
                key={settingsProjectId}
                client={settingsProject.ctx.client}
                open={true}
                onOpenChange={(open) => { if (!open) setSettingsProjectId(null); }}
              />
            )}
```

之后新增：

```tsx
            {themeSettingsProject && (
              <ThemeSettingsDialog
                key={themeSettingsProjectId}
                client={themeSettingsProject.ctx.client}
                open={true}
                onOpenChange={(open) => { if (!open) setThemeSettingsProjectId(null); }}
              />
            )}
```

- [ ] **Step 5: 验证编译**

Run: `npm run build --workspace=packages/app`
Expected: 编译通过。

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/features/activity-bar/index.tsx
git commit -m "feat: restructure project menu into settings submenu"
```

---

## Task 7: i18n

**Files:**
- Modify: `packages/i18n/src/locales/zh-CN.ts`
- Modify: `packages/i18n/src/locales/zh-TW.ts`
- Modify: `packages/i18n/src/locales/en.ts`

- [ ] **Step 1: 修改 zh-CN.ts**

将（第 74-75 行）：

```ts
  // 项目右键菜单：设置欢迎页
  "activity-bar.setWelcomePage": "设置欢迎页",
```

替换为：

```ts
  // 项目右键菜单：设置（二级菜单容器，hover 展开子菜单）
  "activity-bar.settings": "设置",
  // 项目右键菜单 → 设置 → 欢迎页（二级菜单项，打开欢迎页设置弹窗）
  "activity-bar.settings.welcomePage": "欢迎页",
  // 项目右键菜单 → 设置 → 主题（二级菜单项，打开主题 CSS 编辑弹窗）
  "activity-bar.settings.theme": "主题",
```

在文件末尾（最后一个 key 之后）新增 theme-settings 文案块（参考 `welcome-page-settings.*` 的注释风格）：

```ts

  // --- Theme Settings Dialog ---
  // 主题设置弹窗标题
  "theme-settings.title": "设置主题",
  // 主题设置弹窗顶部说明，引导用户通过覆盖 CSS 变量自定义界面外观
  "theme-settings.description": "覆盖 .spherse/theme.css 中的 CSS 变量来自定义界面外观。完整变量清单请参考 create-ui-theme skill。",
  // 读取主题设置失败提示，{message} 为错误信息
  "theme-settings.loadFailed": "读取主题设置失败：{message}",
  // 保存主题设置失败提示，{message} 为错误信息
  "theme-settings.saveFailed": "保存失败：{message}",
  // 主题设置保存成功提示
  "theme-settings.saved": "主题已保存",
```

- [ ] **Step 2: 修改 zh-TW.ts**

将 `"activity-bar.setWelcomePage"` 对应行替换为：

```ts
  "activity-bar.settings": "設定",
  "activity-bar.settings.welcomePage": "歡迎頁",
  "activity-bar.settings.theme": "主題",
```

在文件末尾新增：

```ts
  "theme-settings.title": "設定主題",
  "theme-settings.description": "覆蓋 .spherse/theme.css 中的 CSS 變數來自訂介面外觀。完整變數清單請參考 create-ui-theme skill。",
  "theme-settings.loadFailed": "讀取主題設定失敗：{message}",
  "theme-settings.saveFailed": "儲存失敗：{message}",
  "theme-settings.saved": "主題已儲存",
```

- [ ] **Step 3: 修改 en.ts**

将 `"activity-bar.setWelcomePage"` 对应行替换为：

```ts
  "activity-bar.settings": "Settings",
  "activity-bar.settings.welcomePage": "Welcome Page",
  "activity-bar.settings.theme": "Theme",
```

在文件末尾新增：

```ts
  "theme-settings.title": "Set Theme",
  "theme-settings.description": "Override CSS variables in .spherse/theme.css to customize the UI appearance. See the create-ui-theme skill for the full variable list.",
  "theme-settings.loadFailed": "Failed to load theme settings: {message}",
  "theme-settings.saveFailed": "Save failed: {message}",
  "theme-settings.saved": "Theme saved",
```

- [ ] **Step 4: 运行 i18n 测试与检查**

Run: `npm test --workspace=packages/i18n`
Expected: 全部通过（包括 key 完整性校验——3 个 locale 的 key 集合必须一致）。

如果测试报 key 不匹配，检查是否有遗漏的 key 或拼写错误。

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/locales/zh-CN.ts packages/i18n/src/locales/zh-TW.ts packages/i18n/src/locales/en.ts
git commit -m "feat: add theme settings i18n strings and restructure menu labels"
```

---

## Task 8: Lint + full verification

**Files:** 无文件改动

- [ ] **Step 1: 运行全仓库 lint**

Run: `npm run lint`
Expected: 无错误。如有 lint 错误，运行 `npm run lint:fix` 修复后重新检查。

- [ ] **Step 2: 运行完整验证链**

Run: `npm run build && npm test --workspace=packages/server && npm test --workspace=packages/i18n`
Expected: 全部通过。

- [ ] **Step 3: （如有相关 E2E）运行受影响的 E2E spec**

Run: `npm run test:e2e --workspace=packages/app -- -g "welcome\|project\|settings"`
Expected: 通过。如果 E2E 按旧文案 `设置欢迎页` 定位菜单项，需更新选择器为 `设置 → 欢迎页`。

---

## Task 9: Documentation

**Files:**
- Modify: `docs/official/project-structure.md`
- Modify: `docs/official/architecture.md`
- Modify: `docs/dev/backlog.md`

- [ ] **Step 1: 更新 `docs/official/project-structure.md`**

在 `welcome-page-settings/` 条目旁新增：

```
│           │   ├── theme-settings/        # 项目主题 CSS 编辑弹窗
```

- [ ] **Step 2: 更新 `docs/official/architecture.md`**

在「项目 settings API」段落（提及 `/settings/welcome-page` 的位置）补充：

新增说明：`/api/projects/:projectId/settings/theme` 读写项目级主题 CSS（GET 返回 `{ ok, content }`，文件不存在时 content 为空串；PUT body `{ content }` 原样落盘，返回 `{ ok }`）。

在 feature 列表（提及 `welcome-page-settings` 的位置）新增 `features/theme-settings`。

- [ ] **Step 3: 更新 `docs/dev/backlog.md`**

在「功能增强」区（`用户自定义欢迎页` 条目附近）新增：

```
- [x] **项目设置子菜单 + 主题编辑器**：项目头像右键菜单的「设置欢迎页」改为二级菜单「设置」（含「欢迎页」「主题」），新增主题 CSS 编辑器弹窗直接读写 `.spherse/theme.css`，保存后热更新。参见 `docs/dev/features/2026-06-19-project-settings-dialog/design.md`
```

- [ ] **Step 4: Commit**

```bash
git add docs/official/project-structure.md docs/official/architecture.md docs/dev/backlog.md
git commit -m "docs: sync project structure and backlog with theme settings"
```
