# 升级 pi-agent-core 与 pi-ai 至 0.85.1

## 背景

Spherse 的 agent 运行时依赖两个上游包，均固定在 `packages/core/package.json`：

| 包 | 升级前 | 升级后 |
|---|---|---|
| `@earendil-works/pi-ai` | `0.84.4` | `0.85.1` |
| `@earendil-works/pi-agent-core` | `0.84.4` | `0.85.1` |

- 当前上游最新为 `0.85.1`（0.85.0 于 2026-09-04 发布；0.85.1 于 2026-09-05 修复 0.85.0 误发内部实验代码导致的 SDK 导入失败。上游声明「supported local SDK and stdio RPC API are unchanged」，我们取 0.85.1 而非 0.85.0）。
- `pi-agent-core@0.85.1` 依赖 `pi-ai@^0.85.1`、`pi-telemetry@^0.85.1`，并新增 `@earendil-works/chord@^0.85.1`；本次将 `pi-ai` 一并从 `0.84.4` 升到 `0.85.1`（直接依赖），`pi-telemetry` 与 `chord` 随依赖树传递升级，保持 pi 三包与 chord 均单份。
- 三个 pi 包 engines 仍为 `>=22.19.0`，环境要求不变。

## Spherse 消费面审计

- pi-agent-core：`packages/core/src` 共 44 处引用（43 条 import + `index.ts:53` 的 `export type`；含测试共 56 处），其中除 `packages/core/src/session/agent-assembly.ts:1` 的运行时 `Agent` 外全部为 type-only；`AgentEvent` / `AgentMessage` / `AgentTool` / `StreamFn` 仅作类型。
- pi-ai 运行时符号：`createProvider`、`builtinModels` / `builtinImagesModels`（`providers/all` 子路径）、`openAICompletionsApi`（`api/openai-completions.lazy` 子路径）、`createImagesProvider`、`envApiKeyAuth`；其余 import 为类型。
- 逐文件 diff 0.84.4 与 0.85.1 的 `dist` 后确认：上述运行时符号所在模块 `providers/all`、`api/openai-completions.lazy`、`images-models`、`auth/helpers` 无 diff；`createProvider` 所在 `models.js` 仅将 `fetchDeferred` 重写为 `streamDeferred` + 委托调用（等价重构）。

## 上游 0.84.4 → 0.85.1 变更中影响 Spherse 的点

对照 [pi release v0.85.0](https://github.com/earendil-works/pi/releases/tag/v0.85.0)、[v0.85.1](https://github.com/earendil-works/pi/releases/tag/v0.85.1)，并逐文件 diff 两包 `dist`：

| 变更 | 影响 | 处置 |
|---|---|---|
| **pi-agent-core harness 内部大幅重构**：新增 `harness/runtime/drive`、`harness/execution` 等目录；`harness/reducer` → `harness/runtime/reducer`；`harness/session` 拆分；`search/scanning` 重写；包 exports 新增 `./harness/context`、`./harness/env/nodejs`、`./harness/runtime/reducer`、`./harness/session`，`./session/testing` 迁移为 `./harness/session/testing` | Spherse 不 import harness 与 search 面；唯一运行时 import `Agent` 所在 `agent.js`、`stream-fn.js` 逐字节无 diff，`agent.d.ts` / `agent-loop.d.ts` 无 diff | 无需改动 |
| [0.85.0] `AgentTool` 新增可选 `replay?: "never" \| "safe"` | 可选字段，Spherse 不使用 harness 持久化 replay 语义 | 无需改动 |
| [0.85.0] agent-loop 中止修复：tool 执行前检查 `signal.aborted`，中止的 tool call 产出 error result | 行为修复，Spherse abort 路径受益 | 无需改动 |
| [0.85.0] proxy 传输修复：流 EOF 无终止事件时报错、flush 尾部无换行事件、透传 `providerThinkingLevel` | Spherse 不使用 proxy 传输 | 无需改动 |
| **新增运行时依赖 `@earendil-works/chord`**（其依赖 `esbuild@0.28.1`，因顶层已有 `esbuild@0.25.12` 而嵌套安装）：主入口 re-export `harness/context.js`，其中运行时 import `@earendil-works/chord/context` | node_modules 新增 chord 与嵌套 esbuild（约 10MB 平台二进制）并进入 asar 打包体积；`esbuild` 仅被 chord 的 `bundler` / `node` 子路径引用，主入口运行时不执行 | lockfile 纳入；本 PR 增加一次本地打包 smoke（见「验证」） |
| [0.85.0] pi-ai 类型增量：`providerThinkingLevel`、`vllmPriority`、`supportsMaxOutputTokens`、`supportsMidConvoEffort`、`Models.streamDeferred`、`openrouterProvider()` 返回 `"anthropic-messages" \| "openai-completions"` | 全部为可选字段/新增能力，无破坏性变化 | 无需改动 |
| [0.85.0] pi-ai provider 数据与模型目录刷新（`generatedAt` 2026-09-05）：Spherse 启用的 provider 中新增 `openai/gpt-6-astra`、`anthropic/claude-fable-5-1`、`google/gemini-3.8-flash`、`opencode-go/omen-alpha`、OpenRouter 约 45 个模型（含 `openai/gpt-6-astra-pro` 等），移除 `google/gemini-robotics-er-1.6-preview`、`xai/grok-build-0.1`、OpenRouter 约 15 个（含 `qwen/qwen3.8-max`、若干 `:batch`）；图片模型新增 `microsoft/mai-image-2.6{,-flash}` | 用户可见 surface（模型选择器）变化；被移除模型若仍是用户已保存的 `defaultModel`，`resolveModelWithFallback`（`packages/core/src/session/status.ts:12`）按候选回落，最坏情况由 `resolveOrThrow`（`packages/core/src/session/model-resolver.ts:24`）抛 `ModelNotConfiguredError`，提示用户重新选择模型，不会崩溃 | 无需改动；PR 描述中列出变化，便于发版说明 |
| [0.85.x] pi-ai `api/cloudflare-gateway-binding` 改名 `api/cloudflare-ai-binding`（`createGatewayBindingFetch` → `createAiBindingFetch`） | 该模块经 `./api/*` wildcard 导出，但 Spherse 全仓零引用 | 无需改动 |
| [0.85.0] Anthropic 适配器实质改写：新增 thinking binding controls / mid-conversation output config beta、server-side fallback 处理，请求统一走 `client.beta.messages.create`；`@anthropic-ai/sdk` `0.91.1` → `0.123.0` | 适配器层变更，Spherse 经 provider 工厂消费；E2E 均为 mock，单测只覆盖 header/参数拼装，无真实请求回归 | 已与用户确认：本次不做真实请求 smoke，**显式接受上游回归风险**（kimi-coding 等 anthropic-messages 路径由上游 CLI 主路径承担测试），发版后观察 |
| [0.85.0] OpenAI 兼容 `vllmPriority` / `supportsMaxOutputTokens`、Codex SSE 终止事件解析、prompt cache TTL、retry aborted 响应字段修正等 | 适配器层修复，行为向好 | 无需改动 |
| [0.85.0/0.85.1] coding-agent CLI 功能（TUI/fullscreen、RPC `clear_queue`、`SessionManager.inMemory()` 等） | Spherse 仅用库层 `Agent` / provider-factory / compaction 自定义实现 | 无需改动 |

结论：本次升级对 Spherse 是依赖树、类型面与模型目录数据的增量变更，预期无业务代码改动；风险集中在新增传递依赖（chord/esbuild）进入打包链、适配器行为无自动化回归覆盖。

## 变更内容

1. `packages/core/package.json`：`@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core` `0.84.4` → `0.85.1`。
2. `package-lock.json`：pi 三包升级至 0.85.1；`chord@0.85.1` 及其嵌套 `esbuild@0.28.1` 新增；`@anthropic-ai/sdk` `0.91.1` → `0.123.0` 带来 `standardwebhooks`、`fast-sha256`、`@stablelib/base64` 三个新传递包；`@aws-sdk/*` / `@smithy/*` 有 patch 级重解析漂移（`client-bedrock-runtime` 仍为 `3.1048.0`）。
3. 无业务代码与测试改动：`npm run verify` 全链通过，未出现断言/类型失败，与预期一致。

## 验证

- `npm run lint`：0 errors / 17 warnings（均为 dev 既有基线，本次未新增）
- `npm run verify` 全链通过；各 workspace 单测：i18n 10、presets 5、sdk 47、core 1184、contracts 66、server 297、app 1033、desktop 196、landing 16（共 2854）
- `npm ls @earendil-works/pi-agent-core @earendil-works/pi-ai @earendil-works/pi-telemetry`：三包均 0.85.1 且 dedupe 单份；`chord@0.85.1` 单份
- 适配器契约：`custom-provider-user-agent.test.ts` 在 core 全量中通过（真实适配器 + SSE 解析、`pi (` UA 断言）
- E2E 子集：`chat-streaming-resilience`、`chat-retry`、`chat-v2-replay` 共 7 用例通过（mock chat server 的渲染/会话集成回归，不触达 pi 运行时）
- 打包链路：`electron-builder --dir` 出包成功，asar 内含 `@earendil-works/{chord,pi-agent-core,pi-ai,pi-telemetry}` 与 `esbuild@0.28.1`；`packaged-smoke.spec.ts` 通过（启动、渲染挂载、`/health` 200）
- 未闭环项：anthropic-messages 适配器（kimi-coding 等）无真实请求回归，经用户确认接受上游风险（见上表）
