# 多模型供应商接入

## Overview

将模型供应商列表从前端和 core 的手写常量迁移到 `@earendil-works/pi-ai` 提供的模型元数据。后端统一生成供应商与模型列表，前端设置页只消费后端返回的数据，不再维护 `MODEL_PROVIDER_IDS`、`FALLBACK_MODEL_PROVIDERS` 这类供应商 hardcode。

本 feature 同时将 `@mariozechner/pi-ai` 替换为 `@earendil-works/pi-ai@0.78.0`（包已更名），使用其 `getProviders()` / `getModels(provider)` / `findEnvKeys(provider)` 能力作为模型目录来源。

## Current State

当前实现只把 DeepSeek 和 z.ai 作为一等供应商：

| 位置 | 现状 |
|------|------|
| `packages/core/src/types.ts` | `SUPPORTED_PROVIDERS` 手写 `deepseek`、`zai` 及模型 ID |
| `packages/server/src/routes/settings.ts` | `/api/settings/providers` 直接返回 `SUPPORTED_PROVIDERS` |
| `packages/app/electron/ipc/settings.ts` | `get-supported-providers` 直接返回 `SUPPORTED_PROVIDERS` |
| `packages/app/electron/settings.ts` | 保存和应用 API key 时只遍历 `SUPPORTED_PROVIDERS` |
| `packages/app/src/features/settings/types.ts` | 前端重复维护 `MODEL_PROVIDER_IDS` 和 fallback provider 列表 |
| `packages/app/src/features/settings/store.ts` | 保存设置时只保存 `MODEL_PROVIDER_IDS` 中的 provider |
| `packages/core/src/engine.ts` | `resolveModel()` 遍历 `SUPPORTED_PROVIDERS` 外加 `google`、`anthropic`、`openai` |

这导致新增供应商需要同时改 core、Electron、renderer，且 pi-ai 已支持的模型无法自动出现在 UI 中。

## pi-ai Provider Inventory

当前 workspace 安装版本为 `@mariozechner/pi-ai@0.72.1`。该包已更名为 `@earendil-works/pi-ai`，npm 最新版本为 `0.78.0`。

`0.78.0` 的 generated metadata 包含以下 provider 和模型数量：

| Provider | Model Count | Sample Models |
|----------|-------------|---------------|
| `amazon-bedrock` | 90 | `amazon.nova-2-lite-v1:0`, `amazon.nova-lite-v1:0`, `amazon.nova-micro-v1:0` |
| `anthropic` | 24 | `claude-3-5-haiku-20241022`, `claude-3-5-haiku-latest`, `claude-3-5-sonnet-20240620` |
| `azure-openai-responses` | 42 | `gpt-4`, `gpt-4-turbo`, `gpt-4.1` |
| `cerebras` | 3 | `gpt-oss-120b`, `llama3.1-8b`, `zai-glm-4.7` |
| `cloudflare-ai-gateway` | 35 | `claude-3-5-haiku`, `claude-3-haiku`, `claude-3-opus` |
| `cloudflare-workers-ai` | 12 | `@cf/google/gemma-4-26b-a4b-it`, `@cf/ibm-granite/granite-4.0-h-micro`, `@cf/meta/llama-4-scout-17b-16e-instruct` |
| `deepseek` | 2 | `deepseek-v4-flash`, `deepseek-v4-pro` |
| `fireworks` | 12 | `accounts/fireworks/models/deepseek-v4-flash`, `accounts/fireworks/models/deepseek-v4-pro`, `accounts/fireworks/models/glm-5p1` |
| `github-copilot` | 21 | `claude-haiku-4.5`, `claude-opus-4.5`, `claude-opus-4.6` |
| `google` | 16 | `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-2.5-flash` |
| `google-vertex` | 13 | `gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-2.5-pro` |
| `groq` | 18 | `deepseek-r1-distill-llama-70b`, `gemma2-9b-it`, `groq/compound` |
| `huggingface` | 22 | `MiniMaxAI/MiniMax-M2.1`, `Qwen/Qwen3-Coder-480B-A35B-Instruct` |
| `kimi-coding` | 2 | `kimi-for-coding`, `kimi-k2-thinking` |
| `minimax` | 2 | `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` |
| `minimax-cn` | 2 | `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` |
| `mistral` | 28 | `codestral-latest`, `devstral-2512`, `devstral-medium-2507` |
| `moonshotai` | 7 | `kimi-k2-0711-preview`, `kimi-k2-thinking`, `kimi-k2.5` |
| `moonshotai-cn` | 7 | `kimi-k2-0711-preview`, `kimi-k2-thinking`, `kimi-k2.5` |
| `openai` | 42 | `gpt-4`, `gpt-4-turbo`, `gpt-4.1` |
| `openai-codex` | 6 | `gpt-5.2`, `gpt-5.3-codex`, `gpt-5.3-codex-spark` |
| `opencode` | 41 | `big-pickle`, `claude-haiku-4-5`, `claude-opus-4-1` |
| `opencode-go` | 12 | `deepseek-v4-flash`, `glm-5`, `kimi-k2.5` |
| `openrouter` | 266 | `ai21/jamba-large-1.7`, `amazon/nova-2-lite-v1`, `amazon/nova-lite-v1` |
| `together` | 18 | `MiniMaxAI/MiniMax-M2.5`, `Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8`, `Qwen/Qwen3-Coder-Next-FP8` |
| `vercel-ai-gateway` | 159 | `alibaba/qwen-3-14b`, `alibaba/qwen-3-235b`, `alibaba/qwen3-coder` |
| `xai` | 7 | `grok-3`, `grok-3-fast`, `grok-4.20-0309-non-reasoning` |
| `xiaomi` | 5 | `mimo-v2-flash`, `mimo-v2-omni`, `mimo-v2-pro` |
| `xiaomi-token-plan-ams` | 4 | `mimo-v2-omni`, `mimo-v2-pro`, `mimo-v2.5` |
| `xiaomi-token-plan-cn` | 4 | `mimo-v2-omni`, `mimo-v2-pro`, `mimo-v2.5` |
| `xiaomi-token-plan-sgp` | 4 | `mimo-v2-omni`, `mimo-v2-pro`, `mimo-v2.5` |
| `zai` | 5 | `glm-4.5-air`, `glm-4.7`, `glm-5-turbo` |

`0.78.0` 新增 `together` provider，env key 为 `TOGETHER_API_KEY`。其他 API key 环境变量映射保持不变，例如 `openai -> OPENAI_API_KEY`、`anthropic -> ANTHROPIC_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`、`google -> GEMINI_API_KEY`、`deepseek -> DEEPSEEK_API_KEY`、`zai -> ZAI_API_KEY`。Amazon Bedrock 和 Google Vertex 支持非单一 API key 的认证来源，UI 中需要把这类 provider 标识为需要外部凭据或环境配置。

## Goals

1. 将 `@mariozechner/pi-ai` 替换为 `@earendil-works/pi-ai@0.78.0`，同步 lockfile。
2. 后端和 Electron IPC 从 pi-ai 生成 provider/model 列表，但 UI 只暴露本轮启用的主流 API key provider。
3. 前端设置页移除供应商 hardcode，动态渲染后端返回的已启用供应商。
4. 设置保存支持已启用 provider id，不再只保存 DeepSeek/z.ai。
5. Agent 运行时用 pi-ai 完整 provider 列表解析模型（不受 UI 启用范围限制）。

## 本轮启用的 Provider

设置 UI 仅展示以下支持 API key 的主流 provider：

| Provider ID | Display Name | Env Key | Notes |
|-------------|-------------|---------|-------|
| `openai` | OpenAI | `OPENAI_API_KEY` | |
| `anthropic` | Anthropic | `ANTHROPIC_API_KEY` | 支持 OAuth 但本轮只暴露 API key |
| `google` | Google | `GEMINI_API_KEY` | |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY` | 已有用户数据，无迁移影响 |
| `zai` | z.ai | `ZAI_API_KEY` | 已有用户数据，无迁移影响 |
| `minimax` | MiniMax | `MINIMAX_API_KEY` | |
| `minimax-cn` | MiniMax（国内） | `MINIMAX_CN_API_KEY` | |
| `xiaomi` | 小米 | `XIAOMI_API_KEY` | |
| `moonshotai` | Moonshot AI | `MOONSHOT_API_KEY` | Kimi 系列模型 |
| `moonshotai-cn` | Moonshot AI（国内） | `MOONSHOT_API_KEY` | 共用 `MOONSHOT_API_KEY` |
| `xai` | xAI | `XAI_API_KEY` | Grok 系列模型 |

后端 provider catalog adapter 新增 `ENABLED_PROVIDERS` 常量（provider id 数组）控制哪些 provider 进入 UI catalog。Engine model resolution 不受限于此列表，仍遍历 pi-ai 全部 provider。

## Non-Goals

- 不实现 OAuth 登录流程。`github-copilot`、`anthropic` OAuth、`openai-codex` 等 provider 先以环境变量/API key 表达，不新增浏览器授权交互。
- 不实现 Bedrock/Vertex/Cloudflare 等非 API key 或平台集成类 provider 的凭据配置。后续可按需扩展 `ENABLED_PROVIDERS`。
- 不引入自定义 model endpoint 管理。本 feature 只消费 pi-ai 已知 providers/models。
- 不修改 agent profile frontmatter 的 `model` 字段格式，继续保存 model id 字符串。
- 本轮不启用 `openrouter`、`vercel-ai-gateway`、`fireworks`、`together`、`groq`、`huggingface` 等聚合/平台 provider。用户仍可在 agent profile 中使用这些 provider 的模型，Engine 可以解析。

## Approaches Considered

### Approach A: 手写扩展 `SUPPORTED_PROVIDERS`

在 core 里继续维护完整 provider/model/envKey 常量。

优点是实现改动少，返回结构保持稳定。缺点是会复制 pi-ai 的 generated metadata，升级 pi-ai 后仍需人工同步，前端 hardcode 问题只被移动到 core。

### Approach B: pi-ai 作为唯一来源，core 提供 adapter + 启用列表

core 新增 provider catalog adapter，从 `getProviders()`、`getModels(provider)` 和 `findEnvKeys(provider)` 生成 Spherse 使用的 provider DTO。通过 `ENABLED_PROVIDERS` 数组控制哪些 provider 进入 UI catalog。server 和 Electron IPC 都调用这个 adapter，renderer 只消费 DTO。

优点是 pi-ai 自动提供模型元数据，启用列表只需维护 provider id（不含模型列表），维护成本最低。缺点是需要明确 UI DTO，避免把 pi-ai 的完整 Model 对象直接暴露给前端。

### Approach C: server 动态透传 pi-ai 完整 Model 对象

后端直接返回 `getModels()` 的完整结果，前端自行提取字段。

优点是信息最完整。缺点是把 pi-ai 内部模型结构耦合给 UI，接口体积大，后续 pi-ai 元数据字段变化会影响 renderer。

推荐 Approach B。它保留 pi-ai 的单一数据源，同时给 Spherse 一个稳定、足够小的 API 合约。

## Data Contract

替换当前 `ProviderConfig` 为更明确的共享类型，建议放在 `@spherse/core` 并由 app/server 复用：

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
```

字段说明：

| 字段 | 说明 |
|------|------|
| `id` | pi-ai provider id，例如 `openai` |
| `name` | UI 展示名，由 provider id 转 Title Case，可对少量常见 provider 做 display name 覆盖 |
| `auth.type` | `apiKey` 表示可用 API key 表单配置；本轮启用的 provider 均为 `apiKey`。预留 `external` 和 `unknown` 供后续扩展 |
| `auth.envKeys` | 可展示和保存的环境变量名列表，来自本地 adapter 映射或 pi-ai env helper |
| `models` | 经过裁剪的模型列表，只暴露 UI 和 model resolution 需要的字段 |

当前 `/api/settings/providers` 和 Electron `get-supported-providers` 返回 `Record<string, ProviderConfig>`。本 feature 可保持 record 形态以减少调用方改动：

```ts
type ProviderCatalog = Record<string, ProviderCatalogItem>;
```

## Backend/Core Design

### Provider Catalog Adapter

在 `packages/core` 增加模型目录函数：

| Function | Responsibility |
|----------|----------------|
| `getSupportedProviders()` | 返回 `ENABLED_PROVIDERS` 范围内的 `ProviderCatalog`，内部遍历 pi-ai providers 并过滤 |
| `getProviderEnvKeys(provider)` | 返回可配置 API key env keys |
| `resolveModelById(modelId)` | 遍历 `getProviders()` 后调用 `getModel(provider, modelId)` |

`SUPPORTED_PROVIDERS` 常量不再作为数据源。实现时删除该常量，替换为 `ENABLED_PROVIDERS`（provider id 数组）。展示名覆盖通过 `PROVIDER_DISPLAY_NAMES` 映射实现。新增 provider 只需在 `ENABLED_PROVIDERS` 中追加一行即可。

### Model Resolution

`Engine.resolveModel()` 改为遍历 `getProviders()` 返回的所有 provider，不再手写 `SUPPORTED_PROVIDERS + google + anthropic + openai`。如果多个 provider 存在同名 model id，保持 pi-ai provider 顺序的第一个命中。未来若需要消除歧义，再扩展 agent profile 支持 `provider:model` 或独立 `provider` 字段。

### Settings Persistence

`AppSettings.providers` 改为通用 record：

```ts
export interface AppSettings {
  providers: Record<string, { apiKey: string } | undefined>;
  defaultModel: string;
}
```

Electron `saveSettings()` 不再遍历固定 provider id，而是遍历 incoming providers。保存规则保持现有 mask 语义：

1. 空字符串表示删除该 provider key。
2. 非 masked 新值写入 store。
3. masked 值保留上一版真实 key。
4. 不在 incoming 中的 provider 不写入新的 settings 快照。

本设计选择“incoming 是完整表单快照”：不在 incoming 中的 provider 不保存。这样前端动态列表和持久化状态一致，用户移除 key 后不会留下不可见旧 key。

### Environment Application

`applySettingsToEnv()` 根据 provider catalog 的 `auth.envKeys[0]` 设置 `process.env`。如果 provider 有多个 env key，保存 UI 使用第一个 key 作为主写入目标。对于 `auth.type !== "apiKey"` 的 provider，不通过 UI 写 env；保留用户系统环境变量或外部凭据。

## Server and Electron API Design

两条获取 provider 的路径都应返回同一个 core catalog：

| Path | Change |
|------|--------|
| `packages/server/src/routes/settings.ts` | 调用 core `getSupportedProviders()` |
| `packages/app/electron/ipc/settings.ts` | 调用 core `getSupportedProviders()` |
| `packages/app/src/lib/api.ts` | 更新返回类型为 `ProviderCatalog` |

后端 API 仍使用 `/api/settings/providers`，避免改动 renderer 调用路径。

## Frontend Design

### Types and Store

删除 `MODEL_PROVIDER_IDS` 和 `FALLBACK_MODEL_PROVIDERS`。`useSettingsStore` 直接保存后端返回的完整 `ProviderCatalog`。

`buildSettings()` 遍历 `providers` 中的所有 provider（本轮启用的均为 `apiKey` 类型），把当前 `apiKeys[id]` 写入 `settings.providers[id]`。这样设置页会随 `ENABLED_PROVIDERS` 扩展自动包含新 provider。

`disconnect(id)` 使用该 provider 的 `models` 判断当前默认模型是否需要清空。

### Settings UI

设置页继续保持一个"模型" tab，供应商列表改为动态渲染。本轮启用的 provider 均为 API key 认证，统一显示密码输入框、连接/断开按钮、env key 提示。

默认模型下拉只展示已配置 API key 的 provider 的模型。

## Error Handling

| Scenario | Handling |
|----------|----------|
| pi-ai provider has no models | 过滤该 provider，不返回给 UI |
| settings references removed provider | 加载设置时保留 key 在 store 中，但 UI 不渲染；下次保存按完整快照清理 |
| defaultModel no longer exists | 设置页加载后若无法在 catalog 中找到该 model，显示当前值但提示需要重新选择；保存时允许用户清空或替换 |
| duplicate model id across providers | Engine 按 pi-ai provider 顺序取第一个；设计记录为已知限制 |

## Testing

### Core

- `getSupportedProviders()` 返回 `ENABLED_PROVIDERS` 范围内的 provider，包含 `deepseek`、`zai`、`openai`、`anthropic`、`google`、`xai` 等。
- 每个 provider 的 `models` 来源于 `getModels(provider)`，至少包含 model id/name/provider/api。
- `resolveModelById()` 能解析 DeepSeek/z.ai 以及任意 pi-ai provider 模型，不受 `ENABLED_PROVIDERS` 限制。
- settings 类型支持任意 provider id。

### Electron Settings

- `saveSettings()` 保存任意 provider id 的 API key。
- masked API key 保存时保留旧值。
- 空 API key 会删除对应 provider key。
- `applySettingsToEnv()` 使用 catalog env key 写入 `process.env`。

### App Store/UI

- `load()` 使用后端 provider catalog，不依赖 fallback。
- `buildSettings()` 遍历动态 provider（来自 `ENABLED_PROVIDERS`），而不是固定 DeepSeek/z.ai。
- `disconnect()` 清空属于该 provider 的默认模型。
- 设置页渲染 `ENABLED_PROVIDERS` 范围内的 provider，均显示 API key 输入框。

## Migration Notes

已有 electron-store 数据形态与新的 `Record<string, { apiKey }>` 兼容。DeepSeek/z.ai 用户无需迁移。升级后首次打开设置页时，只有已保存 key 的 provider 会显示为已连接，其余启用的 provider 显示未连接。

如果用户过去手动配置了 `gemini-2.5-pro` 作为项目默认模型，Engine 现在会通过动态 provider 列表解析，无需依赖手写 fallback。

后续新增 provider 只需在 `ENABLED_PROVIDERS` 中追加 provider id，模型列表由 pi-ai 自动提供。

## File Change Summary

| Area | Files | Changes |
|------|-------|---------|
| Dependency | `packages/core/package.json`, `package-lock.json` | 替换 `@mariozechner/pi-ai` 为 `@earendil-works/pi-ai@0.78.0` |
| Core | `packages/core/src/types.ts` | 泛化 `AppSettings.providers`，新增 provider catalog 类型，移除模型 hardcode |
| Core | `packages/core/src/model-providers.ts` | 封装 pi-ai provider catalog adapter |
| Core | `packages/core/src/engine.ts` | `resolveModel()` 遍历 pi-ai providers |
| Server | `packages/server/src/routes/settings.ts` | 返回 core generated provider catalog |
| Electron | `packages/app/electron/settings.ts` | 动态保存 provider keys，动态应用 env |
| Electron | `packages/app/electron/ipc/settings.ts` | 返回 core generated provider catalog |
| Renderer | `packages/app/src/features/settings/types.ts` | 删除 provider hardcode，使用 catalog 类型 |
| Renderer | `packages/app/src/features/settings/store.ts` | 动态 load/build/save/connect/disconnect |
| Renderer | `packages/app/src/features/settings/index.tsx` | 动态 provider UI，处理 apiKey/external/unknown auth |
| Tests | core/app existing tests | 更新 hardcode 断言并补充动态 provider 覆盖 |

## Open Decisions Resolved

1. Provider catalog 来源选择 pi-ai，不在 Spherse 维护模型列表副本。
2. 前端不保留 fallback provider 列表；后端是唯一 provider source。
3. 本轮只启用 11 个主流 API key provider，通过 `ENABLED_PROVIDERS` 控制 UI 范围。Engine model resolution 不受此限制。
4. 本轮不设计 OAuth 和外部凭据配置向导，不实现 Bedrock/Vertex 等平台集成 provider。
5. 默认模型仍保存 model id 字符串，暂不引入 provider-qualified model id。
