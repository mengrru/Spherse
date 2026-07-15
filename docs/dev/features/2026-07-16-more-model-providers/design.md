# 支持更多文本模型供应商

## 需求

支持更多常见文本模型供应商，例如 OpenRouter、GitHub Copilot 等。

## 现状分析

### 架构（已完全数据驱动）

文本 provider 的接入**无需改任何 UI 或解析逻辑**，单一源头是
`packages/core/src/model-providers/index.ts`，三张映射表决定一切：

| 数据结构 | 作用 |
|----------|------|
| `ENABLED_PROVIDERS` | 白名单：决定哪些 pi-ai 内置 provider 对用户可见 |
| `PROVIDER_DISPLAY_NAMES` | provider id → 展示名 |
| `PROVIDER_ENV_KEYS` | provider id → 注入的环境变量名（key 流转的唯一桥梁） |

数据流转链路（已全部打通，新增 provider 自动生效）：

1. `builtinModels()`（pi-ai）已注册 **35+** 个 provider，包括 openrouter / github-copilot / groq / together 等。
2. `getSupportedProviders()` 经 `ENABLED_PROVIDERS` 过滤后产出 catalog。
3. `GET /api/settings/providers` 直接返回 catalog（`packages/server/src/routes/settings.ts`）。
4. 前端 `use-settings-form.ts` 完全按 catalog 动态渲染 provider 卡片与 API Key 输入框——**前端无任何硬编码 provider 列表**。
5. 保存时 `electron/settings.ts` 的 `applySettingsToEnv()` 用 `getSupportedProviders()` 查 `envKeys[0]`，写入 `process.env`；pi-ai 的 `envApiKeyAuth` 读该 env var 鉴权。

结论：**新增一个 API-key 类 provider，只需在三张表各加一行**，catalog / 模型列表 / 解析 / UI / env 注入全部自动贯通。

### pi-ai 已内置但 Spherse 尚未启用的常见 provider

经核查 `node_modules/@earendil-works/pi-ai/dist/providers/`，下列 provider 均使用
`envApiKeyAuth`（纯 API Key 鉴权），可直接启用：

| provider id | env key | 模型数 | API | 备注 |
|-------------|---------|--------|-----|------|
| `openrouter` | `OPENROUTER_API_KEY` | 256 | openai-completions | 聚合器，热门 |
| `github-copilot` | `COPILOT_GITHUB_TOKEN` | 22 | openai-completions / responses / anthropic | 另支持 OAuth（见下） |
| `groq` | `GROQ_API_KEY` | 7 | openai-completions | 极速推理 |
| `together` | `TOGETHER_API_KEY` | 19 | openai-completions | |
| `mistral` | `MISTRAL_API_KEY` | 30 | mistral-conversations | |
| `fireworks` | `FIREWORKS_API_KEY` | 15 | anthropic-messages | |

其余同样纯 key 的 provider（`cerebras`/`nvidia`/`vercel-ai-gateway`/`huggingface`）也可按需扩展，机制完全相同。

### GitHub Copilot 的特殊性

pi-ai 的 `githubCopilotProvider()` 同时声明了两种鉴权：

- `apiKey: envApiKeyAuth("GitHub Copilot token", ["COPILOT_GITHUB_TOKEN"])`
- `oauth: lazyOAuth({ name: "GitHub Copilot", load: loadGitHubCopilotOAuth })`

**本次只启用 apiKey 路径**：用户手动粘贴 Copilot token（`COPILOT_GITHUB_TOKEN`）即可用，
与现有所有 provider 的接入方式一致，无需任何额外工程。

OAuth device-flow（免粘贴 token）是独立的较大增强，需要：
- electron 层接入 pi-ai OAuth helper（`loadGitHubCopilotOAuth`）
- 持久化 refresh token（electron-store / keychain）
- 前端增加「用 GitHub 登录」按钮与 token 刷新流程

**不在本次范围**，作为后续 backlog。

## 实现方案

### 范围

启用 6 个常见 API-key 类文本 provider：
`openrouter`、`github-copilot`、`groq`、`together`、`mistral`、`fireworks`。

### 改动点

**1. `packages/core/src/model-providers/index.ts`**（唯一功能性改动）

- `ENABLED_PROVIDERS` 追加 6 个 id。
- `PROVIDER_DISPLAY_NAMES` 追加展示名：
  - openrouter → `OpenRouter`
  - github-copilot → `GitHub Copilot`
  - groq → `Groq`
  - together → `Together AI`
  - mistral → `Mistral AI`
  - fireworks → `Fireworks AI`
- `PROVIDER_ENV_KEYS` 追加 env key 映射（如上表）。

**2. i18n**（`packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts`）

provider 卡片文案完全数据驱动，无需新增 provider 专属文案。
仅检查「推荐 provider」提示（`settings.models.providersHint*`）是否需要调整——
若希望把 OpenRouter 作为推荐项，更新 hint 文案；否则不动。**默认不动 hint**。

**3. 测试**（`packages/core/src/__tests__/model-providers.test.ts`）

现有测试 mock 了 `builtinModels` 为空，未覆盖 `getSupportedProviders()`。
新增一组测试：用真实 pi-ai `builtinModels()`（非 mock）断言
`getSupportedProviders()` 包含新 provider 且 `envKeys` 正确映射——
锁定 provider 与 env key 的对应关系，防止漂移。

### 不需要改动

- server route / contracts（catalog 形状不变）
- 前端任何组件（数据驱动）
- `applySettingsToEnv`（按 catalog 查 envKeys，自动适配新 provider）
- 模型解析（`resolveModelById` 已遍历所有注册 provider）

### 验证

- `npm test --workspace=packages/core`：新增 provider catalog 测试通过
- `npm run lint`
- `npm run build`
- 手动：启动 app → 设置 → 模型供应商，确认 6 个新 provider 出现、可填 key、可选用模型

## 后续 backlog

- GitHub Copilot OAuth device-flow（免 token 粘贴）
- 按需启用 `cerebras` / `nvidia` / `vercel-ai-gateway` / `huggingface` 等

## 补充：模型选择器改为可搜索 Combobox

### 背景

启用 OpenRouter（256 模型）等 provider 后，默认模型下拉列表项暴增，原生 `<select>` 难以浏览查找。

### 方案

将 `DefaultModelField` 从 `NativeSelect`（原生 `<select>` + optgroup）改为基于 Base UI Combobox（`@base-ui/react/combobox`，已作为依赖安装）的可搜索下拉：

- 新增 `packages/app/src/components/ui/combobox.tsx`——Base UI Combobox 各 part 的薄样式封装（与 `select.tsx` / `popover.tsx` 同构）
- `DefaultModelField` 改用 Combobox：trigger 显示已选模型名 + chevron；弹出层内含搜索框 + 分组列表
- `filter={null}` 禁用 Base UI 内置过滤，改为组件内手动过滤（匹配模型名 OR provider 名），确保搜索覆盖展示名而非仅匹配 value
- `onOpenChange` 重置搜索词，每次打开从全量列表开始
- 新增 i18n key：`settings.models.searchPlaceholder`、`settings.models.noResults`
