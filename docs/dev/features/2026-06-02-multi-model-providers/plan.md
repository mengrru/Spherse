# 多模型供应商接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `@mariozechner/pi-ai` 替换为 `@earendil-works/pi-ai@0.78.0`，通过 pi-ai 元数据生成 provider catalog，前端设置页动态渲染已启用的 11 个 API key provider。

**Architecture:** core 层新增 `model-providers.ts` 封装 pi-ai catalog adapter，通过 `ENABLED_PROVIDERS` 过滤 UI 可见 provider。Engine model resolution 不受限制。Electron settings 改为动态遍历 incoming providers。前端删除所有 provider hardcode。

**Tech Stack:** `@earendil-works/pi-ai@0.78.0`, `@spherse/core`, `@spherse/server`, Electron + React (Zustand)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/package.json` | Modify | 替换依赖 `@mariozechner/pi-ai` → `@earendil-works/pi-ai@^0.78.0` |
| `package-lock.json` | Modify | `npm install` 自动更新 |
| `packages/core/src/types.ts` | Modify | 泛化 `AppSettings.providers`，删除 `SUPPORTED_PROVIDERS` / `SupportedProviderId`，新增 `ProviderCatalogItem` / `ProviderModelItem` 类型 |
| `packages/core/src/model-providers.ts` | Create | `ENABLED_PROVIDERS`、`PROVIDER_DISPLAY_NAMES`、`getSupportedProviders()`、`resolveModelById()` |
| `packages/core/src/engine.ts` | Modify | import 改为新包名 + `resolveModelById`，删除 `SUPPORTED_PROVIDERS` 引用 |
| `packages/core/src/index.ts` | Modify | 导出 `model-providers.ts` 的公共 API |
| `packages/server/src/routes/settings.ts` | Modify | 调用 core `getSupportedProviders()` 替代 `SUPPORTED_PROVIDERS` |
| `packages/app/electron/settings.ts` | Modify | 删除 `SUPPORTED_PROVIDERS` 引用，动态遍历 incoming providers，动态应用 env |
| `packages/app/electron/ipc/settings.ts` | Modify | 调用 core `getSupportedProviders()` 替代 `SUPPORTED_PROVIDERS` |
| `packages/app/src/features/settings/types.ts` | Modify | 删除 `MODEL_PROVIDER_IDS` / `FALLBACK_MODEL_PROVIDERS`，改用 core 的 `ProviderCatalogItem` |
| `packages/app/src/features/settings/store.ts` | Modify | 删除 hardcode 引用，动态遍历 providers |
| `packages/app/src/features/settings/store.test.ts` | Modify | 更新 mock 和断言 |
| `packages/app/src/features/settings/index.tsx` | Modify | 动态渲染 provider 列表替代 `MODEL_PROVIDER_IDS.map` |
| `packages/app/src/lib/api.ts` | Modify | 更新 `getSupportedProviders` 返回类型 |

---

### Task 1: 替换 pi-ai 依赖并更新 lockfile

**Files:**
- Modify: `packages/core/package.json`
- Modify: `package-lock.json` (via npm install)

- [ ] **Step 1: 替换 package.json 中的依赖名和版本**

将 `packages/core/package.json` 的 `dependencies` 中：
```
"@mariozechner/pi-ai": "^0.72.1"
```
替换为：
```
"@earendil-works/pi-ai": "^0.78.0"
```

同时保留 `"@mariozechner/pi-agent-core": "^0.72.1"` 不变（agent-core 未更名）。

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: 成功安装 `@earendil-works/pi-ai@0.78.0`，lockfile 更新

- [ ] **Step 3: 验证 import 可用**

Run: `node --input-type=module -e 'import { getProviders, getModels, getModel } from "@earendil-works/pi-ai"; console.log(getProviders().length, "providers");'`
Expected: 输出 provider 数量

- [ ] **Step 4: 提交依赖变更**

```bash
git add packages/core/package.json package-lock.json
git commit -m "chore: replace @mariozechner/pi-ai with @earendil-works/pi-ai@0.78.0"
```

---

### Task 2: core 层 — 新增 provider catalog adapter

**Files:**
- Create: `packages/core/src/model-providers.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 泛化 `AppSettings.providers` 并删除 hardcode**

在 `packages/core/src/types.ts` 中：

1. 将 `AppSettings` 的 `providers` 字段从固定 deepseek/zai 改为通用 record：

```ts
export interface AppSettings {
  providers: Record<string, { apiKey: string } | undefined>;
  defaultModel: string;
}
```

2. 删除 `SUPPORTED_PROVIDERS` 常量和 `SupportedProviderId` 类型（整段删除，第 55-68 行）。

3. 新增 provider catalog 类型：

```ts
export interface ProviderCatalogItem {
  id: string;
  name: string;
  auth: {
    type: "apiKey" | "external" | "unknown";
    envKeys: string[];
  };
  models: ProviderModelItem[];
}

export interface ProviderModelItem {
  id: string;
  name: string;
  provider: string;
  api: string;
  reasoning: boolean;
  input: readonly string[];
  contextWindow?: number;
  maxTokens?: number;
}

export type ProviderCatalog = Record<string, ProviderCatalogItem>;
```

- [ ] **Step 2: 创建 `packages/core/src/model-providers.ts`**

```ts
import { getProviders, getModels, getModel, findEnvKeys } from "@earendil-works/pi-ai";
import type { ProviderCatalog, ProviderCatalogItem, ProviderModelItem } from "./types.js";

export const ENABLED_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "zai",
  "minimax",
  "minimax-cn",
  "xiaomi",
  "moonshotai",
  "moonshotai-cn",
  "xai",
] as const;

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  zai: "z.ai",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax（国内）",
  xiaomi: "小米",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI（国内）",
  xai: "xAI",
};

function toDisplayName(id: string): string {
  return PROVIDER_DISPLAY_NAMES[id] ?? id.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join(" ");
}

function resolveAuthType(provider: string): "apiKey" | "external" | "unknown" {
  const envKeys = findEnvKeys(provider);
  if (envKeys && envKeys.length > 0) return "apiKey";
  if (provider === "amazon-bedrock" || provider === "google-vertex") return "external";
  return "unknown";
}

export function getSupportedProviders(): ProviderCatalog {
  const allProviders = getProviders();
  const enabledSet = new Set<string>(ENABLED_PROVIDERS);
  const catalog: ProviderCatalog = {};

  for (const provider of allProviders) {
    if (!enabledSet.has(provider)) continue;
    const models = getModels(provider);
    if (models.length === 0) continue;

    const envKeys = findEnvKeys(provider) ?? [];
    const authType = resolveAuthType(provider);

    const items: ProviderModelItem[] = models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      api: m.api,
      reasoning: m.reasoning ?? false,
      input: m.input ?? ["text"],
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    }));

    const item: ProviderCatalogItem = {
      id: provider,
      name: toDisplayName(provider),
      auth: { type: authType, envKeys },
      models: items,
    };
    catalog[provider] = item;
  }

  return catalog;
}

export function resolveModelById(modelId: string) {
  const providers = getProviders();
  for (const provider of providers) {
    const model = (getModel as any)(provider, modelId);
    if (model) return model;
  }
  throw new Error(`Could not resolve model: ${modelId}`);
}
```

- [ ] **Step 3: 更新 `packages/core/src/index.ts` 导出**

追加一行：

```ts
export { getSupportedProviders, resolveModelById, ENABLED_PROVIDERS } from "./model-providers.js";
```

- [ ] **Step 4: 验证 core 编译**

Run: `npm run build --workspace=packages/core`
Expected: 编译成功

- [ ] **Step 5: 提交 core catalog adapter**

```bash
git add packages/core/src/types.ts packages/core/src/model-providers.ts packages/core/src/index.ts
git commit -m "feat(core): add pi-ai provider catalog adapter with ENABLED_PROVIDERS"
```

---

### Task 3: core 层 — 更新 Engine model resolution

**Files:**
- Modify: `packages/core/src/engine.ts`

- [ ] **Step 1: 更新 import 和 `resolveModel`**

在 `packages/core/src/engine.ts` 中：

1. 将第 3 行的 import 改为：
```ts
import { streamSimple } from "@earendil-works/pi-ai";
```

2. 将第 7 行删除（不再 import `SUPPORTED_PROVIDERS`）。

3. 新增 import：
```ts
import { resolveModelById } from "./model-providers.js";
```

4. 将 `resolveModel` 方法（第 213-225 行）替换为：
```ts
  private resolveModel(modelId: string): any {
    return resolveModelById(modelId);
  }
```

- [ ] **Step 2: 验证 core 编译**

Run: `npm run build --workspace=packages/core`
Expected: 编译成功

- [ ] **Step 3: 运行 core 测试**

Run: `npm test --workspace=packages/core`
Expected: 所有测试通过

- [ ] **Step 4: 提交 Engine 改动**

```bash
git add packages/core/src/engine.ts
git commit -m "feat(core): use resolveModelById from catalog adapter"
```

---

### Task 4: server 层 — 更新 settings route

**Files:**
- Modify: `packages/server/src/routes/settings.ts`

- [ ] **Step 1: 替换 `SUPPORTED_PROVIDERS` 为 `getSupportedProviders()`**

将 `packages/server/src/routes/settings.ts` 全部替换为：

```ts
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../index.js";
import { getSupportedProviders } from "@spherse/core";

export function registerSettingsRoutes(fastify: FastifyInstance, _ctx: AppContext): void {
  fastify.get("/api/settings/providers", async () => {
    return getSupportedProviders();
  });
}
```

- [ ] **Step 2: 验证 server 编译**

Run: `npm run build --workspace=packages/server`
Expected: 编译成功

- [ ] **Step 3: 提交 server 改动**

```bash
git add packages/server/src/routes/settings.ts
git commit -m "feat(server): use core provider catalog for settings route"
```

---

### Task 5: Electron 层 — 更新 settings 和 IPC

**Files:**
- Modify: `packages/app/electron/settings.ts`
- Modify: `packages/app/electron/ipc/settings.ts`

- [ ] **Step 1: 更新 `packages/app/electron/settings.ts`**

1. 将第 4 行 import 替换为：
```ts
import { getSupportedProviders } from "@spherse/core";
```

2. 将 `saveSettings` 函数（第 43-59 行）替换为：
```ts
export function saveSettings(incoming: AppSettings): void {
  const prev = settingsStore.get("settings");
  const merged: AppSettings = { providers: {}, defaultModel: incoming.defaultModel };
  for (const [id, newConfig] of Object.entries(incoming.providers)) {
    const prevConfig = prev?.providers?.[id];
    if (newConfig && newConfig.apiKey.trim() === "") {
      continue;
    } else if (newConfig?.apiKey && !newConfig.apiKey.includes("****")) {
      merged.providers[id] = { apiKey: newConfig.apiKey };
    } else if (prevConfig?.apiKey) {
      merged.providers[id] = { apiKey: prevConfig.apiKey };
    }
  }
  settingsStore.set("settings", merged);
  applySettingsToEnv(merged);
}
```

3. 将 `applySettingsToEnv` 函数（第 67-76 行）替换为：
```ts
function applySettingsToEnv(settings: AppSettings): void {
  const catalog = getSupportedProviders();
  for (const [id, config] of Object.entries(settings.providers)) {
    if (config?.apiKey) {
      const item = catalog[id];
      if (item?.auth.envKeys[0]) {
        process.env[item.auth.envKeys[0]] = config.apiKey;
      }
    }
  }
}
```

- [ ] **Step 2: 更新 `packages/app/electron/ipc/settings.ts`**

将全部替换为：

```ts
import { ipcMain } from "electron";
import { getMaskedSettings, saveSettings } from "../settings.js";
import { getSupportedProviders } from "@spherse/core";
import type { AppSettings } from "@spherse/core";

export function registerSettingsIpc(): void {
  ipcMain.handle("get-settings", () => {
    return getMaskedSettings();
  });

  ipcMain.handle("save-settings", (_event, settings: AppSettings) => {
    saveSettings(settings);
    return { success: true };
  });

  ipcMain.handle("get-supported-providers", () => {
    return getSupportedProviders();
  });
}
```

- [ ] **Step 3: 验证编译**

Run: `npm run build --workspace=packages/server`
Expected: 编译成功

- [ ] **Step 4: 提交 Electron 改动**

```bash
git add packages/app/electron/settings.ts packages/app/electron/ipc/settings.ts
git commit -m "feat(electron): dynamic provider settings persistence and env application"
```

---

### Task 6: 前端 — 更新 types 和 store

**Files:**
- Modify: `packages/app/src/features/settings/types.ts`
- Modify: `packages/app/src/features/settings/store.ts`
- Modify: `packages/app/src/features/settings/store.test.ts`
- Modify: `packages/app/src/lib/api.ts`

- [ ] **Step 1: 更新 `packages/app/src/features/settings/types.ts`**

将全部替换为：

```ts
import type { ProviderCatalogItem } from "@spherse/core";

export type ProviderConfig = ProviderCatalogItem;

export interface AppSettings {
  providers?: Record<string, { apiKey?: string } | undefined>;
  defaultModel?: string;
}

export interface SettingsApi {
  getSettings: () => Promise<AppSettings | null>;
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;
  getSupportedProviders: () => Promise<Record<string, ProviderConfig>>;
}
```

- [ ] **Step 2: 更新 `packages/app/src/features/settings/store.ts`**

将全部替换为：

```ts
import { create } from "zustand";
import {
  type AppSettings,
  type ProviderConfig,
  type SettingsApi,
} from "./types";

type SaveMessage = "saved" | "error" | null;

interface SettingsStore {
  providers: Record<string, ProviderConfig>;
  apiKeys: Record<string, string>;
  defaultModel: string;
  saving: boolean;
  message: SaveMessage;
  load: (api: SettingsApi) => Promise<void>;
  setApiKey: (id: string, value: string) => void;
  setDefaultModel: (model: string) => void;
  buildSettings: (keys?: Record<string, string>, model?: string) => AppSettings;
  save: (api: SettingsApi, keys?: Record<string, string>, model?: string) => Promise<boolean>;
  connect: (api: SettingsApi, id: string) => Promise<boolean>;
  disconnect: (api: SettingsApi, id: string) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  providers: {},
  apiKeys: {},
  defaultModel: "",
  saving: false,
  message: null,

  async load(api) {
    const [providers, settings] = await Promise.all([
      api.getSupportedProviders(),
      api.getSettings(),
    ]);
    const apiKeys: Record<string, string> = {};
    for (const [id, config] of Object.entries(settings?.providers ?? {})) {
      if (config?.apiKey) {
        apiKeys[id] = config.apiKey;
      }
    }
    set({
      providers: providers ?? {},
      apiKeys,
      defaultModel: settings?.defaultModel ?? "",
    });
  },

  setApiKey(id, value) {
    set((state) => ({
      apiKeys: { ...state.apiKeys, [id]: value },
    }));
  },

  setDefaultModel(model) {
    set({ defaultModel: model });
  },

  buildSettings(keys = get().apiKeys, model = get().defaultModel) {
    const providers: Record<string, { apiKey: string } | undefined> = {};
    for (const id of Object.keys(get().providers)) {
      providers[id] = { apiKey: (keys[id] ?? "").trim() };
    }
    return {
      providers,
      defaultModel: model,
    };
  },

  async save(api, keys = get().apiKeys, model = get().defaultModel) {
    set({ saving: true, message: null });
    try {
      await api.saveSettings(get().buildSettings(keys, model));
      set({ message: "saved" });
      return true;
    } catch {
      set({ message: "error" });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  async connect(api, id) {
    if (!get().apiKeys[id]?.trim()) return false;
    return get().save(api);
  },

  async disconnect(api, id) {
    const apiKeys = { ...get().apiKeys, [id]: "" };
    const providers = get().providers;
    const defaultModel = get().defaultModel;
    const nextDefaultModel =
      defaultModel && providers[id]?.models.some((m) => m.id === defaultModel)
        ? ""
        : defaultModel;
    set({ apiKeys, defaultModel: nextDefaultModel });
    return get().save(api, apiKeys, nextDefaultModel);
  },
}));
```

- [ ] **Step 3: 更新 `packages/app/src/lib/api.ts` 中的 `getSupportedProviders` 返回类型**

将第 197-204 行替换为：

```ts
    async getSupportedProviders(): Promise<Record<string, import("@spherse/core").ProviderCatalogItem>> {
      const res = await fetch(`${baseUrl}/api/settings/providers`);
      return res.json();
    },
```

- [ ] **Step 4: 验证编译**

Run: `npm run build --workspace=packages/app`
Expected: 编译成功

- [ ] **Step 5: 提交前端 types/store 改动**

```bash
git add packages/app/src/features/settings/types.ts packages/app/src/features/settings/store.ts packages/app/src/lib/api.ts
git commit -m "feat(app): dynamic provider types and store from backend catalog"
```

---

### Task 7: 前端 — 更新 settings UI

**Files:**
- Modify: `packages/app/src/features/settings/index.tsx`

- [ ] **Step 1: 更新 `packages/app/src/features/settings/index.tsx`**

关键改动：

1. 第 18 行 import 改为：
```ts
import { type ProviderConfig, type SettingsApi } from "./types";
```

2. `ModelSettingsTab` 中（第 50 行），将 `getModelProviders()` 替换为 `providers`：
```ts
  const providers = useSettingsStore((state) => state.providers);
```

3. 第 73-74 行 `DefaultModelField` props 中将 `providers={modelProviders}` 改为 `providers={providers}`。

4. 第 82-94 行 provider 列表渲染，将 `MODEL_PROVIDER_IDS.map` 改为动态遍历：
```tsx
                {Object.entries(providers).map(([id, config]) => (
                  <ModelProviderItem
                    key={id}
                    id={id}
                    config={config}
                    apiKey={apiKeys[id] ?? ""}
                    onApiKeyChange={(value) => setApiKey(id, value)}
                    onConnect={() => handleConnect(id)}
                    onDisconnect={() => handleDisconnect(id)}
                  />
                ))}
```

5. `ModelProviderItem` 的 `config.envKey` 改为 `config.auth.envKeys[0] ?? ""`。在 props 类型中将 `config: ProviderConfig` 保持不变（类型已是 `ProviderCatalogItem`）。

6. `DefaultModelField` 的 `providers` prop 类型已随 `ProviderConfig` 更新。其中 `config.models` 从 `readonly string[]` 变为 `ProviderModelItem[]`，需要将 `config.models.map((model) => ...)` 改为 `config.models.map((m) => ...)`，`value={model}` → `value={m.id}`，显示文本用 `{m.id}`。

- [ ] **Step 2: 验证编译**

Run: `npm run build --workspace=packages/app`
Expected: 编译成功

- [ ] **Step 3: 提交前端 UI 改动**

```bash
git add packages/app/src/features/settings/index.tsx
git commit -m "feat(app): dynamic provider list rendering in settings UI"
```

---

### Task 8: 更新测试

**Files:**
- Modify: `packages/app/src/features/settings/store.test.ts`

- [ ] **Step 1: 重写 `store.test.ts`**

将全部替换为：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderCatalogItem } from "@spherse/core";
import type { SettingsApi } from "./types";
import { useSettingsStore } from "./store";

const mockProvider = (id: string, name: string, models: string[]): [string, ProviderCatalogItem] => [
  id,
  {
    id,
    name,
    auth: { type: "apiKey" as const, envKeys: [`${id.toUpperCase()}_API_KEY`] },
    models: models.map((m) => ({
      id: m,
      name: m,
      provider: id,
      api: "openai-completions",
      reasoning: false,
      input: ["text"] as const,
    })),
  },
];

const MOCK_PROVIDERS: Record<string, ProviderCatalogItem> = Object.fromEntries([
  mockProvider("deepseek", "DeepSeek", ["deepseek-v4-flash", "deepseek-v4-pro"]),
  mockProvider("zai", "z.ai", ["glm-4.5-air", "glm-4.7", "glm-5-turbo", "glm-5.1", "glm-5v-turbo"]),
  mockProvider("openai", "OpenAI", ["gpt-4", "gpt-4.1"]),
]);

function createApi(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    getSupportedProviders: vi.fn().mockResolvedValue(MOCK_PROVIDERS),
    getSettings: vi.fn().mockResolvedValue(null),
    saveSettings: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe("useSettingsStore", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      providers: {},
      apiKeys: {},
      defaultModel: "",
      saving: false,
      message: null,
    });
  });

  it("loads providers, api keys, and default model", async () => {
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({
        providers: {
          deepseek: { apiKey: "deepseek-key" },
          zai: { apiKey: "zai-key" },
        },
        defaultModel: "glm-5.1",
      }),
    });

    await useSettingsStore.getState().load(api);

    expect(api.getSupportedProviders).toHaveBeenCalledTimes(1);
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().providers.deepseek.name).toBe("DeepSeek");
    expect(useSettingsStore.getState().apiKeys).toEqual({
      deepseek: "deepseek-key",
      zai: "zai-key",
    });
    expect(useSettingsStore.getState().defaultModel).toBe("glm-5.1");
  });

  it("builds settings from dynamic providers and trims api keys", async () => {
    const api = createApi();
    useSettingsStore.setState({
      providers: MOCK_PROVIDERS,
      apiKeys: { deepseek: " key ", openai: "openai-key" },
      defaultModel: "deepseek-v4-flash",
    });

    const ok = await useSettingsStore.getState().save(api);

    expect(ok).toBe(true);
    const saved = (api.saveSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.providers.deepseek.apiKey).toBe("key");
    expect(saved.providers.openai.apiKey).toBe("openai-key");
    expect(saved.providers.zai.apiKey).toBe("");
    expect(saved.defaultModel).toBe("deepseek-v4-flash");
  });

  it("clears default model when disconnecting its provider", async () => {
    const api = createApi();
    useSettingsStore.setState({
      providers: MOCK_PROVIDERS,
      apiKeys: { deepseek: "key", zai: "zai-key" },
      defaultModel: "deepseek-v4-flash",
    });

    await useSettingsStore.getState().disconnect(api, "deepseek");

    expect(useSettingsStore.getState().apiKeys.deepseek).toBe("");
    expect(useSettingsStore.getState().defaultModel).toBe("");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("does not clear default model when disconnecting a different provider", async () => {
    const api = createApi();
    useSettingsStore.setState({
      providers: MOCK_PROVIDERS,
      apiKeys: { deepseek: "key", zai: "zai-key" },
      defaultModel: "deepseek-v4-flash",
    });

    await useSettingsStore.getState().disconnect(api, "zai");

    expect(useSettingsStore.getState().defaultModel).toBe("deepseek-v4-flash");
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npm test --workspace=packages/app`
Expected: 所有测试通过

- [ ] **Step 3: 提交测试改动**

```bash
git add packages/app/src/features/settings/store.test.ts
git commit -m "test(app): update settings store tests for dynamic providers"
```

---

### Task 9: 全量编译验证

- [ ] **Step 1: 全量 build**

Run: `npm run build`
Expected: 所有 4 个 package 编译成功

- [ ] **Step 2: 运行 core 测试**

Run: `npm test --workspace=packages/core`
Expected: 所有测试通过

- [ ] **Step 3: 运行 app 测试**

Run: `npm test --workspace=packages/app`
Expected: 所有测试通过
