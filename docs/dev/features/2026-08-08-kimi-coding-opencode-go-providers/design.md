# 支持 Kimi For Coding 与 OpenCode Go 文本模型供应商

## 需求

启用两个 pi-ai 已内置、Spherse 尚未开放的文本模型供应商：

- `kimi-coding` — Kimi 面向编程的专用端点（`https://api.kimi.com/coding`，`anthropic-messages` API），含 k3 / kimi-for-coding 等模型（部分带 reasoning）
- `opencode-go` — OpenCode Go 供应商，多 API（`anthropic-messages` / `openai-completions` / `openai-responses`）

两者均已存在于 `@earendil-works/pi-ai@0.84.1`（`dist/providers/{kimi-coding,opencode-go}.js`），仅需在 Spherse 侧「启用」。

## 现状分析

架构已完全数据驱动，单一源头是 `packages/core/src/model-providers/index.ts` 的三张表（参见前序 `docs/dev/features/2026-07-16-more-model-providers/design.md`）：

| 数据结构 | 作用 |
|----------|------|
| `ENABLED_PROVIDERS` | 白名单：决定哪些 pi-ai 内置 provider 对用户可见 |
| `PROVIDER_DISPLAY_NAMES` | provider id → 展示名 |
| `PROVIDER_ENV_KEYS` | provider id → 注入的环境变量名（key 流转的唯一桥梁） |

数据流转链路（已全部打通，新增 provider 自动生效）：

1. `builtinModels()`（pi-ai）已注册全部内置 provider，含 `kimi-coding` / `opencode-go`。
2. `getSupportedProviders()` 经 `ENABLED_PROVIDERS` 过滤后产出 catalog。
3. `GET /api/settings/providers` 直接返回 catalog。
4. 前端 `use-settings-form.ts` 完全按 catalog 动态渲染 provider 卡片与 API Key 输入框——前端无任何硬编码 provider 列表。
5. 保存时 `electron/settings.ts` 的 `applySettingsToEnv()` 用 catalog 查 `envKeys[0]` 写入 `process.env`，pi-ai 的 `envApiKeyAuth` 读该 env var 鉴权。

结论：**新增一个纯 API-key 类 provider，只需在三张表各加一行**，catalog / 模型列表 / 解析 / UI / env 注入全部自动贯通。

### 两个 provider 的鉴权形态（已核查 pi-ai 源码）

| provider id | env key | baseUrl | API | 备注 |
|-------------|---------|---------|-----|------|
| `opencode-go` | `OPENCODE_API_KEY` | 模型自带 | anthropic-messages / openai-completions / openai-responses | 纯 `envApiKeyAuth`，无其他鉴权，直接启用 |
| `kimi-coding` | `KIMI_API_KEY` | `https://api.kimi.com/coding`（provider 级） | anthropic-messages | 同时声明 `oauth: lazyOAuth("Kimi Code (subscription)")`，**本次只启用 apiKey 路径**，OAuth 订阅作为后续 backlog |

### 命名澄清

`kimi-coding` *就是* Kimi 的 provider（pi-ai 中没有单独的 `kimi`）。Spherse 已启用的 `moonshotai` / `moonshotai-cn`（月之暗面）在消费侧也以「Kimi」品牌著称，但属于不同公司 / API。为避免歧义，`kimi-coding` 展示名沿用 pi-ai 内置名 **`Kimi For Coding`**，明确区分于 `Moonshot AI`。

## 实现方案

### 范围

启用 2 个纯 API-key 类文本 provider：`kimi-coding`、`opencode-go`。

### 改动点

**1. `packages/core/src/model-providers/index.ts`**（唯一功能性改动）

- `ENABLED_PROVIDERS` 追加 `"kimi-coding"`、`"opencode-go"`。
- `PROVIDER_DISPLAY_NAMES` 追加：
  - `"kimi-coding"` → `Kimi For Coding`
  - `opencode-go` → `OpenCode Go`
- `PROVIDER_ENV_KEYS` 追加：
  - `"kimi-coding"` → `["KIMI_API_KEY"]`
  - `opencode-go` → `["OPENCODE_API_KEY"]`

**2. `packages/core/src/__tests__/model-providers-catalog.test.ts`**

`EXPECTED_ENV_KEYS` 追加两个 id 的 env key 映射，锁定 provider 与 env key 的对应关系，防止漂移。泄漏检查用例（`does not leak providers that are not enabled`）未涉及这两个 id，无需改动。

### 不需要改动（已验证数据驱动）

- server route / contracts（`packages/server/src/routes/settings.ts`、`contracts/settings.ts`）—— catalog 形状不变
- 前端任何组件（`settings/index.tsx`、`ModelProviderItem.tsx`、`DefaultModelField.tsx`、`use-settings-form.ts`）—— 按 catalog 动态渲染
- `applySettingsToEnv`（按 catalog 查 `envKeys[0]`，自动适配新 provider）
- 模型解析（`resolveModelById` 已遍历所有注册 provider）
- i18n（无 per-provider 文案，仅有通用 `settings.provider.*` / `settings.models.*`）
- 图片 provider（本次仅文本）

### 验证

- `npm run verify --workspace=packages/core`：catalog 测试通过（含新 provider 的 env key 断言、auth type 为 apiKey、catalog 含模型）
- `npm run verify`：lint + build + core/i18n/app 单测 + i18n check 全绿
- 手动：启动 app → 设置 → 模型供应商，确认 Kimi For Coding、OpenCode Go 两个 provider 出现、可填 key、其模型出现在默认模型可搜索下拉中

## 不在范围（后续 backlog）

- **`azure-openai-responses`**：pi-ai 已内置且用 `envApiKeyAuth("AZURE_OPENAI_API_KEY")`，但运行时 `resolveAzureConfig`（`@earendil-works/pi-ai/dist/api/azure-openai-responses.js`）在缺少 base URL 时抛错——需要 `AZURE_OPENAI_BASE_URL` 或 `AZURE_OPENAI_RESOURCE_NAME`。当前 Spherse 的凭证模型只有单一 `apiKey` 字段（`ProviderCredentials`，`packages/core/src/types.ts`），设置 UI 也只收集一个 key 字符串，**无法表达 endpoint/resource-name**。接入需扩展 `ProviderCredentials` + contracts schema + `applySettingsToEnv`（注入额外 env var）+ `ModelProviderItem` UI（新增 endpoint 输入）+ merge/mask helper，属独立 feature，单独成 spec。
- **`kimi-coding` OAuth 订阅**：pi-ai 的 `kimiCodingProvider()` 同时声明 `oauth: lazyOAuth("Kimi Code (subscription)")`。Spherse 当前无任何 OAuth 基建（无 deep-link handler、无 token 持久化、无登录按钮、无 `"oauth"` auth type），与 GitHub Copilot OAuth 同属后续 backlog。
