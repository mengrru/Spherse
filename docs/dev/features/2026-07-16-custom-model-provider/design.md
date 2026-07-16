# 设置：自定义模型供应商

## 背景

当前「设置 → 模型」tab 的供应商列表完全来自硬编码的内置目录（`packages/core/src/model-providers/index.ts:7-47` 的 `ENABLED_PROVIDERS` / `PROVIDER_DISPLAY_NAMES` / `PROVIDER_ENV_KEYS`），`getSupportedProviders()` 从 pi-ai 的 `builtinModels()` 过滤产出。用户无法接入内置列表之外的 OpenAI 兼容端点（Ollama、vLLM、LM Studio、SiliconFlow、自建网关等）。

本次需求：在设置中允许用户添加**自定义模型供应商**。

## 需求对齐结论（brainstorming）

- **API 兼容范围**：仅 OpenAI 兼容（`openai-completions`）。覆盖绝大多数自建/本地/第三方网关场景，v1 不做 Anthropic / Google 兼容。
- **模型列表来源**：仅手动输入 model id。不做 `/v1/models` 自动拉取（v1 保持简单；用户填写实际要用的 model id）。
- **功能范围**：仅文本模型 tab。图片生成走 `ImagesApi`，自定义图片供应商需求极少，不在本次。
- **鉴权**：API Key 可选。本地服务器（Ollama / LM Studio / vLLM 无 auth）无需填 Key 即可使用。

## 现状调研结论

### 1. 内置供应商是 env-var 驱动，core 不感知 settings

- `packages/app/electron/settings.ts:105-127` `applySettingsToEnv`：把 `settings.models.text.providers[id].apiKey` 按 `PROVIDER_ENV_KEYS` 映射成 `process.env[envKey]`。
- pi-ai 内置 provider 工厂（如 `deepseekProvider`）用 `envApiKeyAuth(name, ["DEEPSEEK_API_KEY"])` 从 env 取 key。
- core 的 `model-providers/index.ts` 是 module 级单例 `const models: Models = builtinModels()`，启动即固定，与 settings 无直接耦合。

### 2. pi-ai 原生支持运行时注册自定义 provider

- `builtinModels(): MutableModels`（`@earendil-works/pi-ai/dist/providers/all.d.ts`）返回的是 **Mutable** 集合，支持 `setProvider(provider)` / `deleteProvider(id)`。
- `createProvider({ id, name, baseUrl, auth, models, api })`（`pi-ai/dist/models.d.ts`）从部件组装 provider，内置工厂与自定义 provider 走同一路径。
- 项目已有先例：`packages/core/src/model-providers/index.ts:50-51` 用 `builtinImagesModels()` 返回的 `MutableImagesModels.setProvider(createZhipuImagesProvider())` 注入智谱图片 provider。
- OpenAI 兼容流的构造方式（参照 `pi-ai/dist/providers/deepseek.js`）：`api: openAICompletionsApi()`、`auth: { apiKey: envApiKeyAuth(...) }`、`models: [...]`。

### 3. 启动顺序天然提供注册时机

`packages/app/electron/main.ts:10-11`：

```
restoreEnvFromSettings();   // 应用 env（含 settings → env）
await ensureServer();        // 启动 Fastify（同进程，调用 core 单例）
```

`restoreEnvFromSettings()` 在 server 启动**之前**同步执行。server 与 settings IPC 同处 Electron 主进程，共享 core 单例。因此可在 `restoreEnvFromSettings` 阶段把自定义 provider 注册进 core 单例，server 的 `getSupportedProviders()` 即可看到。

### 4. 无 Key 的兼容性约束

`pi-ai/dist/api/openai-completions.js:27-33` 的 `getClientApiKey`：既无 `apiKey` 又无 `authorization` header 时 **抛 `No API key for provider`**。因此 keyless 场景必须提供某种占位（本地服务器会忽略 `Authorization` 头）。

### 5. 模型 id / sampling 复用既有链路

- 自定义 provider 用 `openai-completions`，`getChatStreamFn` 的 `injectTopP`（`model-providers/index.ts:167-185`）已覆盖 `openai-completions`；temperature 由 `streamSimple` 原生支持。采样参数对自定义供应商自动生效。
- `resolveModelById`（`model-providers/index.ts:105-120`）按 `provider/model` 解析，自定义 provider 注册进 `models` 单例后即可解析，无需改动。

## 方案对比

### 方案 A（采用）：core 暴露注册 API，闭包注入 apiKey

- core 新增 `syncCustomProviders(defs, apiKeys)`：用 `MutableModels.setProvider/deleteProvider` 同步运行时集合；自定义 provider 的 `auth` 用闭包捕获 apiKey（不走 env）。
- 内置供应商**完全不动**（仍 env-var 驱动），零回归风险。
- keyless 在 auth resolver 内返回占位 apiKey，自然支持。
- 复用既有 `MutableModels.setProvider` 模式（与 zhipu-images 同构）。
- 代价：core 由「纯 env」变为「自定义 provider 直接收 key」。但 key 本就常驻主进程内存（settings.ts），不引入新的暴露面。

### 方案 B：为每个自定义供应商合成 env 变量

- 给每个自定义 id 合成唯一 env 变量名，`applySettingsToEnv` 写入，provider 用 `envApiKeyAuth(name, [envVar])`。
- 优点：与内置完全一致。
- 致命缺点：`envApiKeyAuth.resolve` 在无 key 时返回 `undefined`（视为未配置），keyless 本地服务器无法工作，需 hack（占位 key）。且动态 env 命名脆弱、污染 `process.env` 命名空间。

### 方案 C：引入 CredentialStore 统一凭据层

- 给 `builtinModels({ credentials })` 传一个基于 electron-store 的 `CredentialStore`，内置 + 自定义都迁到 store。
- 优点：最贴合 pi-ai 设计意图。
- 缺点：需把内置供应商一并迁出 env，改动面大、回归风险高，超出本 feature 范围（过度工程）。

**结论：采用方案 A。** 最小回归面、原生支持 keyless、复用既有 setProvider 模式。

## 设计决策

### 数据模型

`packages/core/src/types.ts`：

```ts
export interface CustomProviderDef {
  id: string;          // 唯一；自定义供应商 id，同时是 providers map 的 key
  name: string;        // 显示名
  baseUrl: string;     // 如 http://localhost:11434/v1
  models: string[];    // 用户手动填写的 model id 列表（≥1）
  keyless: boolean;    // true = 无需 API Key（本地服务器）
}

export interface AppSettings {
  locale: string;
  models: { text: ModelGroupSettings; image: ModelGroupSettings };
  customProviders?: CustomProviderDef[];   // 新增：自定义供应商定义（无密钥）
  debugToolsEnabled?: boolean;
  theme?: ThemeMode;
}
```

> 自定义供应商的 **apiKey 仍存在既有** `models.text.providers[customId].apiKey`（与内置共用 map，mask/merge 链路复用）。`customProviders` 只存「定义」（id/name/baseUrl/models/keyless），不含密钥。

`ProviderCatalogItem` 增加可选标记，供 UI 区分可编辑性与 keyless：

```ts
export interface ProviderCatalogItem {
  id: string;
  name: string;
  auth: { type: "apiKey" | "external" | "unknown"; envKeys: string[] };
  models: ProviderModelItem[];
  custom?: boolean;      // 新增：标记为用户自定义（可编辑/删除）
  keyless?: boolean;     // 新增：无需 API Key
  baseUrl?: string;      // 新增：自定义供应商展示用
}
```

### id 生成与冲突避免

- 内置 id 为小写英文。自定义 id 统一加 `custom-` 前缀，避免与内置/`models.getProviders()` 内置 id 冲突。
- 生成规则：`custom-${slugify(name)}`；若与已有（内置或自定义）冲突，追加 `-2`、`-3`……
- **rename 只改 name，不改 id**（id 内部稳定，作为 providers map key 与 edit/delete 锚点）。

### core 注册 API

`packages/core/src/model-providers/index.ts`：

```ts
import { createProvider, type ApiKeyAuth } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { CustomProviderDef } from "../types.js";

const models: MutableModels = builtinModels();   // 类型从 Models 改为 MutableModels
let registeredDefs: CustomProviderDef[] = [];    // getSupportedProviders() 读取的镜像
const customIds = new Set<string>();              // 已注册的自定义 id（= registeredDefs 的 id 集）

const KEYLESS_PLACEHOLDER = "sk-no-key";          // 本地服务器会忽略 Authorization 头

function customAuth(apiKey: string | undefined, keyless: boolean): ApiKeyAuth {
  return {
    name: "API Key",
    resolve: async () => {
      if (apiKey) return { auth: { apiKey }, source: "API Key" };
      if (keyless) return { auth: { apiKey: KEYLESS_PLACEHOLDER }, source: "Keyless" };
      return undefined; // 既无 key 又非 keyless → 视为未配置
    },
  };
}

function buildCustomProvider(def: CustomProviderDef, apiKey: string | undefined) {
  const modelList = def.models.map((m) => ({
    id: m,
    name: m,
    api: "openai-completions" as const,
    provider: def.id,
    baseUrl: def.baseUrl,
    reasoning: false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,   // v1 默认值（见「已知限制」）
    maxTokens: 4096,
  }));
  return createProvider({
    id: def.id,
    name: def.name,
    baseUrl: def.baseUrl,
    auth: { apiKey: customAuth(apiKey, def.keyless) },
    models: modelList,
    api: openAICompletionsApi(),
  });
}

export function syncCustomProviders(defs: CustomProviderDef[], apiKeys: Record<string, string>): void {
  const nextIds = new Set(defs.map((d) => d.id));
  // 删除已移除的
  for (const id of [...customIds].filter((i) => !nextIds.has(i))) {
    models.deleteProvider(id);
    customIds.delete(id);
  }
  // upsert
  for (const def of defs) {
    models.setProvider(buildCustomProvider(def, apiKeys[def.id]));
    customIds.add(def.id);
  }
  registeredDefs = defs;   // 更新 catalog 镜像
}
```

`getSupportedProviders()` 在内置循环后追加自定义段：

```ts
for (const def of registeredDefs) {           // syncCustomProviders 维护的镜像
  catalog[def.id] = {
    id: def.id,
    name: def.name,
    auth: { type: def.keyless ? "unknown" : "apiKey", envKeys: [] },
    models: def.models.map((m) => ({
      id: m, name: m, provider: def.id, api: "openai-completions",
      reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096,
    })),
    custom: true,
    keyless: def.keyless,
    baseUrl: def.baseUrl,
  };
}
```

> `getSupportedProviders()`、`resolveModelById()`、`getChatStreamFn()` 对自定义 provider 自动可用（均基于 `models` 单例）。

### 持久化与启动注册

`packages/app/electron/settings.ts`：

- `saveSettings(merged)`：`customProviders: incoming.customProviders ?? prev?.customProviders ?? []`（无密钥，整体替换）。既有 `mergeModelGroup` 复用（自定义 apiKey 走同一 providers map 的 mask/merge）。
- `getMaskedSettings()`：透传 `customProviders`（无需 mask）。
- `applySettingsToEnv(settings)`：末尾调用 `syncCustomProviders(settings.customProviders ?? [], extractKeys(settings.models?.text?.providers))`。

启动链路（`main.ts:10`）`restoreEnvFromSettings()` → `applySettingsToEnv()` → `syncCustomProviders()`，在 `ensureServer()` 之前完成注册。

### API contract

`packages/server/src/contracts/settings.ts`：

- `providerCatalogItem` 增加可选字段 `custom?: boolean`、`keyless?: boolean`、`baseUrl?: string`（均为可选，不破坏既有响应校验）。
- `/api/settings/providers`（`server/src/routes/settings.ts:9-14`）无需改 handler，`getSupportedProviders()` 已含自定义项。
- **不新增 CRUD 路由**：自定义供应商定义通过既有 `save-settings` IPC 整体保存（与 providers/apiKeys 一致），保持单一保存路径。

### 前端表单与 UI

`packages/app/src/features/settings/use-settings-form.ts`：

- 新增 state `customProviders: CustomProviderDef[]`（从 settings 加载）。
- 新增方法：
  - `addCustomProvider(def)`：生成 id（`custom-<slug>` + 去重）→ 追加 def → save（`customProviders` + 空 apiKey）。
  - `updateCustomProvider(id, def)`：替换 def（保留 id）→ save。
  - `removeCustomProvider(id)`：删除 def + 清 `apiKeys[id]` + 若 `defaultModel` 以 `${id}/` 开头则清空 → save。
- save payload 在既有 `models` 基础上附带 `customProviders`。

UI（`packages/app/src/features/settings/index.tsx` 的 `ModelGroupTab`，仅 `kind === "text"`）：

```
[既有] DefaultModelField  （下拉自动包含自定义供应商模型，按 name 分组）
[既有] AdvancedSettings
[既有] SectionTitle「模型提供商」+ tooltip
[既有] 内置 ModelProviderItem 列表
       └─ 自定义供应商也渲染为 ModelProviderItem（custom 标记）
[新增] 「+ 添加自定义供应商」按钮 → 打开 CustomProviderDialog
```

- `ModelProviderItem`（`ModelProviderItem.tsx`）扩展可选 props：`onEdit?`、`onDelete?`、`baseUrl?`、`keyless?`。
  - 自定义行：显示「自定义」badge + baseUrl 副标题 + 编辑/删除按钮。
  - keyless 行：显示「无需 API Key」badge，**不渲染** apiKey 输入与 connect/disconnect（定义存在即默认可用）。
  - keyed 自定义行：apiKey 输入 + connect/disconnect，与内置一致。
- 新增 `CustomProviderDialog.tsx`：复用 `Dialog`，字段 = 名称 / Base URL / 模型 id（多行或逗号分隔输入）/ keyless 开关。提交前校验：名称非空、baseUrl 合法（http/https）、≥1 个 model id。

### i18n

`packages/i18n/src/locales/zh-CN.ts`（基准）新增（每条配 UI 场景注释，en/zh-TW 同步）：

- `settings.provider.addCustom` — 「+ 添加自定义供应商」按钮
- `settings.provider.customBadge` — 「自定义」badge
- `settings.provider.keylessBadge` / `settings.provider.keylessHint` — 「无需 API Key」
- `settings.provider.dialog.titleAdd` / `titleEdit`
- `settings.provider.dialog.name` / `namePlaceholder`
- `settings.provider.dialog.baseUrl` / `baseUrlPlaceholder`（如 `http://localhost:11434/v1`）
- `settings.provider.dialog.models` / `modelsPlaceholder` / `modelsHint`（逗号或换行分隔）
- `settings.provider.dialog.keyless` / `keylessDesc`
- `settings.provider.dialog.save` / `cancel`
- `settings.provider.dialog.errNameRequired` / `errBaseUrlRequired` / `errBaseUrlInvalid` / `errModelsRequired`

### 测试

- **core**：`syncCustomProviders` 的 add/update/remove diff；`getSupportedProviders()` 含自定义段且标记正确；`resolveModelById` 解析自定义 model；keyless auth resolver 返回占位、keyed 返回真实 key。
- **app（electron）**：`settings.test.ts` 覆盖 `customProviders` 的 merge/透传、`removeCustomProvider` 清 defaultModel、`applySettingsToEnv` 触发 `syncCustomProviders`。
- **app（renderer）**：`use-settings-form` 的 add/update/remove wiring；`CustomProviderDialog` 校验（空名/非法 URL/空模型）；`ModelProviderItem` custom/keyless 分支结构测试。
- **server**：contract test 覆盖 `providerCatalog` 含可选 `custom/keyless/baseUrl` 字段。

## 全链路改动清单

| 层 | 文件 | 改动 |
|----|------|------|
| 类型 | `core/src/types.ts` | `+ CustomProviderDef`；`AppSettings.customProviders?`；`ProviderCatalogItem` `+ custom?/keyless?/baseUrl?` |
| 注册 | `core/src/model-providers/index.ts` | `models` 改 `MutableModels`；`+ syncCustomProviders`、`buildCustomProvider`、`customAuth`；`getSupportedProviders()` 追加自定义段 |
| 持久化 | `app/electron/settings.ts` | `saveSettings`/`getMaskedSettings` 透传 `customProviders`；`applySettingsToEnv` 末尾 `syncCustomProviders` |
| contract | `server/src/contracts/settings.ts` | `providerCatalogItem` `+ custom?/keyless?/baseUrl?` |
| 表单 | `app/src/features/settings/use-settings-form.ts` | `+ customProviders` state + add/update/remove 方法 + save 附带 |
| UI | `app/src/features/settings/index.tsx` | 文本 tab 渲染自定义行 + 「添加」按钮 + Dialog 装配 |
| UI 组件 | `app/src/features/settings/ModelProviderItem.tsx` | 扩展 `onEdit/onDelete/baseUrl/keyless` 分支 |
| UI 组件 | `app/src/features/settings/CustomProviderDialog.tsx` | 新增：创建/编辑表单 |
| id 工具 | `app/src/features/settings/custom-provider-id.ts` | 新增：`slugify` + `custom-` 前缀 + 去重 |
| i18n | `i18n/src/locales/{zh-CN,en,zh-TW}.ts` | 新增自定义供应商相关文案 |

## 已知限制 / 不在本次范围

- **不自动拉取模型列表**：用户手动填 model id；`/v1/models` 自动发现留作后续。
- **contextWindow / maxTokens 不可配**：v1 用默认值（32768 / 4096）。本地大窗口模型可能被过早截断；可作后续按模型配置。
- **仅 OpenAI 兼容**：不做 Anthropic / Google 兼容端点。
- **仅文本 tab**：图片 tab 不支持自定义供应商。
- **price/cost 不统计**：自定义模型 cost 全 0（本地模型无计费；第三方网关计费未知）。
- **defaultModel 引用被删供应商**：删除自定义供应商时清空关联 defaultModel；使用该模型的活跃 session 下一轮会报错（可接受，与内置 disconnect 行为一致）。
- 不改 pi-ai 上游。
