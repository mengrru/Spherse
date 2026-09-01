# 升级 pi-agent-core 与 pi-ai 至 0.84.4

## 背景

Spherse 的 agent 运行时依赖两个上游包，均固定在 `packages/core/package.json`：

| 包 | 升级前 | 升级后 |
|---|---|---|
| `@earendil-works/pi-ai` | `0.84.2` | `0.84.4` |
| `@earendil-works/pi-agent-core` | `0.84.2` | `0.84.4` |

`pi-agent-core@0.84.4` 依赖 `pi-ai@^0.84.4` 与 `pi-telemetry@^0.84.4`，故两者同步升级以保持依赖树单份（升级后 `npm ls` 确认 dedupe）。Node engines 三包均仍为 `>=22.19.0`，环境要求不变。

## 上游 0.84.2 → 0.84.4 变更中影响 Spherse 的点

对照 [pi release v0.84.3](https://github.com/earendil-works/pi/releases/tag/v0.84.3) 与 [v0.84.4](https://github.com/earendil-works/pi/releases/tag/v0.84.4)：

| 变更 | 影响 | 处置 |
|---|---|---|
| **[0.84.3 breaking] `GoogleThinkingLevel` 类型改名 `GoogleApiThinkingLevel`**（新增 `ResolvedGoogleThinkingLevel`） | 全仓 grep 无使用 | 无需改动 |
| **[0.84.3] Anthropic / Azure OpenAI / Google / Mistral / OpenAI 适配器默认发送 pi 运行时 `User-Agent`**（openai-completions `createClient` 默认注入 `getPiUserAgent()`，即 `pi (<platform> <release>; <arch>)`，显式 headers 可覆盖） | 破坏 `custom-provider-user-agent.test.ts`「builtin provider 保留 OpenAI SDK 默认 UA（`OpenAI/JS`）」用例。行为影响：内置 provider 请求头会携带含 OS/arch 的 pi UA | 更新该用例：断言 builtin provider（deepseek / openai-completions）请求携带 pi 运行时 UA（`/^pi \(/`）；custom provider 的 `suppressUserAgent`（注入 `User-Agent: null` deletion marker，openai SDK `buildHeaders` 先 delete 再 append）链路在 0.84.4 下端到端仍成立，其余 5 个用例不变 |
| [0.84.3] provider-neutral `toolChoice`、Anthropic server-side refusal fallback、Kimi usage 计费修正、ZAI thinking 元数据修正、xAI 内置模型改走 Responses API 等 | 适配器层透明变更；Spherse 无 toolChoice 使用，`m.api` 透传不受影响 | 无需改动 |
| [0.84.3] `@opentelemetry/api` 从 pi-ai 依赖树移除 | lockfile 顶层条目消失 | 无需改动 |
| [0.84.4] terminal capability overrides、extension UI prompt events、RPC `clear_queue`、fullscreen 选择复制等 | coding-agent/CLI 层面功能，Spherse 仅用库层 `Agent`/provider-factory API | 无需改动 |
| [0.84.4] OpenAI 兼容 reasoning replay、OpenRouter reasoning controls、Mistral fragmented tool calls 等修复 | 适配器层修复，行为向好 | 无需改动 |

## 变更内容

1. `packages/core/package.json`：`@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core` `0.84.2` → `0.84.4`。
2. `package-lock.json`：同步升级 pi 三包，移除 `@opentelemetry/api`，AWS SDK / smithy / protobufjs 传递版本刷新。
3. `packages/core/src/__tests__/model-providers/custom-provider-user-agent.test.ts`：builtin provider UA 用例适配上游行为变更（0.84.2 升级时 kimi-coding 用例已先行适配，本次补齐 openai-completions 路径）。

## 验证

- `npm run verify` 全链通过（lint 0 errors / 16 warnings 为既有基线、build、typecheck、全部单测、i18n check）
- `npm ls @earendil-works/pi-agent-core @earendil-works/pi-ai`：两包均 0.84.4 且 dedupe 单份
