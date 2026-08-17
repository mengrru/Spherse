# 升级 pi-agent-core 与 pi-ai 至 0.84.2

## 背景

Spherse 的 agent 运行时依赖两个上游包，均固定在 `packages/core/package.json`：

| 包 | 升级前 | 升级后 |
|---|---|---|
| `@earendil-works/pi-ai` | `0.84.1` | `0.84.2` |
| `@earendil-works/pi-agent-core` | `0.84.1` | `0.84.2` |

`pi-agent-core@0.84.2` 依赖 `pi-ai@^0.84.2` 与 `pi-telemetry@^0.84.2`，故两者需同步升级以保持依赖树一致（升级后仅剩一份 pi-ai / pi-telemetry）。

## 上游 0.84.1 → 0.84.2 变更中影响 Spherse 的点

对照 [pi release v0.84.2](https://github.com/earendil-works/pi/releases/tag/v0.84.2)：

| 变更 | 影响 | 处置 |
|---|---|---|
| **kimi-coding 请求改用 pi 运行时 `User-Agent`**（`mergeClientHeaders` 对 kimi-coding 无条件删除任何 UA 并注入 `getPiUserAgent()`，模型级 `KimiCLI/1.5` header 已从模型目录移除） | 破坏 `custom-provider-user-agent.test.ts` 中「builtin provider 保留模型级 UA」的用例（`KimiCLI/1.5`） | 更新该用例：断言 kimi-coding 请求携带 pi 运行时 UA（`/^pi \(/`）；custom provider 的 `suppressUserAgent` 语义不受影响 |
| **移除 Mistral SDK 依赖**（`@mistralai/mistralai` 替换为原生 Chat Completions HTTP 流） | lockfile 移除 `@mistralai/mistralai`；Spherse 无直接引用 | 无需改动（已确认无 `@mistralai/mistralai` import） |
| OpenAI Responses deferred tool loading / DeepSeek 兼容性修复等 | 不影响 Spherse 当前使用路径 | 无需改动 |

## 变更内容

1. `packages/core/package.json`：`@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core` `0.84.1` → `0.84.2`。
2. `package-lock.json`：同步升级 pi-ai / pi-agent-core / pi-telemetry，移除 `@mistralai/mistralai`。
3. `packages/core/src/__tests__/model-providers/custom-provider-user-agent.test.ts`：kimi-coding UA 用例适配上游行为变更。

## 验证

- `npm test`（core 795 / server 197 / sdk 47 / i18n 10 / app 870 / desktop 80 / landing 10 全绿）
- `npm run build`（全仓类型检查 + 打包通过）
- `npm run lint`（0 errors，16 warnings 为既有基线）
