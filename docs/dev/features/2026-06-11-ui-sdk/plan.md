# UI SDK 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 iframe → app 的 postMessage action 通信框架，同时支持 app 内代码直接调用。

**Architecture:** Handler Registry 模式。postMessage listener 收到消息后通过 `dispatchAction` 分发到注册的 handler；app 内通过 `SpherseAction` 封装对象直接调用同一个 `dispatchAction`。外部调用经 rate limiter 限流。

**Tech Stack:** TypeScript, React hooks, Playwright (E2E), Zustand store

---

### Task 1: 核心基础设施 — types + registry + rate-limit

**Files:**
- Create: `packages/app/src/ui-sdk/types.ts`
- Create: `packages/app/src/ui-sdk/registry.ts`
- Create: `packages/app/src/ui-sdk/rate-limit.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
import type { NavigateFunction } from "react-router";
import type { ApiClient } from "../lib/api";

export interface ActionContext {
  navigate: NavigateFunction;
  projectKey: string;
  client: ApiClient;
}

export type ActionHandler<P = Record<string, unknown>> = (
  params: P,
  ctx: ActionContext,
) => void | Promise<void>;
```

- [ ] **Step 2: 创建 registry.ts**

```typescript
import type { ActionContext, ActionHandler } from "./types";

const handlers = new Map<string, ActionHandler>();

export function registerAction(name: string, handler: ActionHandler): void {
  handlers.set(name, handler);
}

export function dispatchAction(
  name: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
): void | Promise<void> {
  const handler = handlers.get(name);
  if (!handler) {
    console.warn(`[spherse:action] Unknown action: ${name}`);
    return;
  }
  return handler(params, ctx);
}
```

- [ ] **Step 3: 创建 rate-limit.ts**

```typescript
const MAX_CALLS_PER_MINUTE = 10;
const WINDOW_MS = 60_000;
const timestamps: number[] = [];

export function checkRateLimit(): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= MAX_CALLS_PER_MINUTE) return false;
  timestamps.push(now);
  return true;
}

export function resetRateLimit(): void {
  timestamps.length = 0;
}
```

`resetRateLimit` 导出仅供测试使用。

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit --project packages/app/tsconfig.json`
Expected: 无错误

---

### Task 2: Action Handlers — openFile + createSession

**Files:**
- Create: `packages/app/src/ui-sdk/handlers/open-file.ts`
- Create: `packages/app/src/ui-sdk/handlers/create-session.ts`

- [ ] **Step 1: 创建 handlers/open-file.ts**

```typescript
import { registerAction } from "../registry";

registerAction("openFile", (params, ctx) => {
  const { path } = params as { path: string };
  if (!path || typeof path !== "string") return;

  ctx.navigate(
    `/project/${ctx.projectKey}/content?path=${encodeURIComponent(path)}`,
  );
});
```

- [ ] **Step 2: 创建 handlers/create-session.ts**

```typescript
import { registerAction } from "../registry";
import { useProjectDataStore } from "../../stores/project-data-store";

registerAction("createSession", async (params, ctx) => {
  const { agentId, message } = params as {
    agentId: string;
    message?: string;
  };
  if (!agentId || typeof agentId !== "string") return;

  const session = await useProjectDataStore
    .getState()
    .createSession(ctx.projectKey, ctx.client, agentId, message);
  if (session) {
    ctx.navigate(`/project/${ctx.projectKey}/chat/${session.id}`);
  }
});
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit --project packages/app/tsconfig.json`
Expected: 无错误

---

### Task 3: SpherseAction 封装（App 内调用入口）

**Files:**
- Create: `packages/app/src/ui-sdk/api.ts`

- [ ] **Step 1: 创建 api.ts**

```typescript
import { dispatchAction } from "./registry";
import type { ActionContext } from "./types";
import { useAppStore } from "../stores/app-store";

function getActionContext(): ActionContext {
  const state = useAppStore.getState();
  const activeKey = state.activeProjectKey;
  const project = activeKey ? state.projects.get(activeKey) : undefined;
  if (!activeKey || !project) {
    throw new Error("[spherse:action] No active project context");
  }
  return {
    navigate: () => {
      throw new Error("[spherse:action] navigate not available outside React");
    },
    projectKey: activeKey,
    client: project.ctx.client,
  };
}

export const SpherseAction = {
  openFile: (params: { path: string }) => {
    const ctx = getActionContext();
    return dispatchAction("openFile", params, ctx);
  },
  createSession: (params: { agentId: string; message?: string }) => {
    const ctx = getActionContext();
    return dispatchAction("createSession", params, ctx);
  },
};
```

注意：`getActionContext()` 中 `navigate` 抛错，因为 SpherseAction 用于非 UI 场景时无法提供 React Router navigate。如需 navigate 能力，应通过 hook 内的 `dispatchAction` 使用。

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit --project packages/app/tsconfig.json`
Expected: 无错误

---

### Task 4: postMessage Listener Hook + ProjectLayout 集成

**Files:**
- Create: `packages/app/src/ui-sdk/use-spherse-message-listener.ts`
- Create: `packages/app/src/ui-sdk/index.ts`（barrel export）
- Modify: `packages/app/src/layouts/ProjectLayout.tsx`

- [ ] **Step 1: 创建 use-spherse-message-listener.ts**

```typescript
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { dispatchAction } from "./registry";
import { checkRateLimit } from "./rate-limit";
import type { ActionContext } from "./types";
import { useAppStore } from "../stores/app-store";

export function useSpherseMessageListener(projectKey: string): void {
  const navigate = useNavigate();
  const project = useAppStore((s) => s.projects.get(projectKey));

  useEffect(() => {
    if (!project) return;

    const ctx: ActionContext = {
      navigate,
      projectKey,
      client: project.ctx.client,
    };

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "spherse:action") return;
      if (typeof event.data.action !== "string") return;
      if (!checkRateLimit()) return;
      void dispatchAction(
        event.data.action,
        event.data.params ?? {},
        ctx,
      );
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [navigate, projectKey, project]);
}
```

- [ ] **Step 2: 创建 index.ts barrel export**

```typescript
export { SpherseAction } from "./api";
export { useSpherseMessageListener } from "./use-spherse-message-listener";
```

- [ ] **Step 3: 在 ProjectLayout.tsx 集成 hook**

在 `ProjectLayout` 函数体中（现有 hooks 之后、`useCustomTheme` 附近）添加：

```typescript
import { useSpherseMessageListener } from "../ui-sdk";
```

在组件函数体内添加：

```typescript
useSpherseMessageListener(projectKey);
```

放置位置：在 `useCustomTheme(project.ctx.projectRoot, project.ctx.port);` 这行之后。

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit --project packages/app/tsconfig.json`
Expected: 无错误

- [ ] **Step 5: 验证 lint**

Run: `npm run lint --workspace=packages/app`
Expected: 无错误

---

### Task 5: E2E 验收测试

**Files:**
- Create: `packages/app/e2e/ui-sdk.spec.ts`

- [ ] **Step 1: 创建 E2E 测试文件**

```typescript
import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

function projectKeyBase(projectPath: string): string {
  const name = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? "project";
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return key || "project";
}

async function createUiSdkProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-sdk-"));
  await mkdir(path.join(root, ".spherse", "agents", "test-agent"), {
    recursive: true,
  });
  await mkdir(path.join(root, "world"), { recursive: true });

  await writeFile(
    path.join(root, ".spherse", "agents", "test-agent", "profile.md"),
    [
      "---",
      "id: test-agent",
      "name: Test Agent",
      "type: assistant",
      "model: deepseek-v4-flash",
      "tools: []",
      "---",
      "You are a test agent.",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(root, "world", "target-file.md"),
    "# Target File\n\nThis is the target file content.\n",
  );

  await writeFile(
    path.join(root, "sdk-test-trigger.html"),
    [
      "<!DOCTYPE html>",
      "<html><body>",
      '<button id="btn-open" onclick="openFile()">Open File</button>',
      '<button id="btn-session" onclick="createSession()">Create Session</button>',
      "<script>",
      "function openFile() {",
      '  window.parent.postMessage({',
      '    type: "spherse:action",',
      '    action: "openFile",',
      '    params: { path: "world/target-file.md" }',
      '  }, "*");',
      "}",
      "function createSession() {",
      '  window.parent.postMessage({',
      '    type: "spherse:action",',
      '    action: "createSession",',
      '    params: { agentId: "test-agent", message: "E2E test" }',
      '  }, "*");',
      "}",
      "</script></body></html>",
    ].join("\n"),
  );

  return { root, triggerHtmlPath: "sdk-test-trigger.html" };
}

async function launchAppWithSdkProject(project: { root: string }) {
  const userDataDir = await mkdtemp(
    path.join(tmpdir(), "spherse-e2e-sdk-user-"),
  );
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_ENABLE_LOGGING: "1",
      XDG_CONFIG_HOME: userDataDir,
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async (projectRoot) => {
    await window.electronAPI.addOpenProject(projectRoot);
    await window.electronAPI.setLastActiveProject(projectRoot);
  }, project.root);
  return { app, page };
}

test("openFile action navigates from iframe", async () => {
  const project = await createUiSdkProject();
  const { app, page } = await launchAppWithSdkProject(project);

  try {
    const projectUrl = `/project/${projectKeyBase(project.root)}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.triggerHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-open")).toBeVisible({ timeout: 30_000 });

    await frame.locator("#btn-open").click();

    await expect(page).toHaveURL(
      new RegExp(
        `#/project/${projectKeyBase(project.root)}/content\\?path=world%2Ftarget-file\\.md`,
      ),
    );
  } finally {
    await app.close();
  }
});

test("createSession action navigates from iframe", async () => {
  const project = await createUiSdkProject();
  const { app, page } = await launchAppWithSdkProject(project);

  try {
    const projectUrl = `/project/${projectKeyBase(project.root)}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.triggerHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-session")).toBeVisible({ timeout: 30_000 });

    await frame.locator("#btn-session").click();

    await expect(page).toHaveURL(
      new RegExp(
        `#/project/${projectKeyBase(project.root)}/chat/[^/?#]+$`,
      ),
    );
    await expect(
      page.getByPlaceholder("输入消息... (Shift+Enter 换行)"),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test("unknown action is ignored", async () => {
  const project = await createUiSdkProject();
  const { app, page } = await launchAppWithSdkProject(project);

  try {
    const projectUrl = `/project/${projectKeyBase(project.root)}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.triggerHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-open")).toBeVisible({ timeout: 30_000 });

    const urlBefore = page.url();

    await page.evaluate(() => {
      window.postMessage(
        {
          type: "spherse:action",
          action: "unknownAction",
          params: {},
        },
        "*",
      );
    });

    await page.waitForTimeout(500);
    expect(page.url()).toBe(urlBefore);
  } finally {
    await app.close();
  }
});

test("rate limit blocks excess calls", async () => {
  const project = await createUiSdkProject();
  const { app, page } = await launchAppWithSdkProject(project);

  try {
    const projectUrl = `/project/${projectKeyBase(project.root)}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.triggerHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-open")).toBeVisible({ timeout: 30_000 });

    let navigatedCount = 0;
    page.on("framenavigated", () => {
      navigatedCount++;
    });

    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "spherse:action",
            action: "openFile",
            params: { path: "world/target-file.md" },
          },
          "*",
        );
      });
    }

    await page.waitForTimeout(2000);
    expect(navigatedCount).toBeLessThanOrEqual(10);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: 运行 E2E 测试验证**

先确保 app 已构建：

Run: `npm run build --workspace=packages/app`

然后运行测试：

Run: `npm run test:e2e --workspace=packages/app -- e2e/ui-sdk.spec.ts`
Expected: 4 个测试全部通过

---

### Task 6: LLM Skill 文档

**Files:**
- Create: `packages/presets/skills/use-ui-sdk/SKILL.md`

- [ ] **Step 1: 检查现有 skill 结构**

查看 `packages/presets/skills/` 下现有 skill 的 SKILL.md 格式作为参考。

- [ ] **Step 2: 创建 skill 文档**

内容涵盖：
- 协议格式（`type: "spherse:action"` 消息结构）
- 可用 action 列表及参数说明（createSession、openFile）
- 各场景下的 postMessage 代码模板
- 注意事项（rate limit 每分钟 10 次、参数校验行为、三个 iframe 场景均可用）
- 不支持的操作（文件写入、删除等）

- [ ] **Step 3: 验证 presets 构建**

Run: `npm run build --workspace=packages/presets`
Expected: 无错误

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| Create | `packages/app/src/ui-sdk/types.ts` |
| Create | `packages/app/src/ui-sdk/registry.ts` |
| Create | `packages/app/src/ui-sdk/rate-limit.ts` |
| Create | `packages/app/src/ui-sdk/handlers/open-file.ts` |
| Create | `packages/app/src/ui-sdk/handlers/create-session.ts` |
| Create | `packages/app/src/ui-sdk/api.ts` |
| Create | `packages/app/src/ui-sdk/use-spherse-message-listener.ts` |
| Create | `packages/app/src/ui-sdk/index.ts` |
| Modify | `packages/app/src/layouts/ProjectLayout.tsx` |
| Create | `packages/app/e2e/ui-sdk.spec.ts` |
| Create | `packages/presets/skills/use-ui-sdk/SKILL.md` |
