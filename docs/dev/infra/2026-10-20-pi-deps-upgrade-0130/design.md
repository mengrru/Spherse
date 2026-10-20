# 升级 pi-agent-core 与 pi-ai 至 1.3.0

## 背景

Spherse 的 agent 运行时依赖两个上游包，均固定在 `packages/core/package.json`：

| 包 | 升级前 | 升级后 |
|---|---|---|
| `@earendil-works/pi-ai` | `0.85.1` | `1.3.0` |
| `@earendil-works/pi-agent-core` | `0.85.1` | `1.3.0` |

- 当前上游最新为 `1.3.0`（2026-10-15 发布）。跨度：0.85.1 → 0.86.x → 0.87.x → 0.99.x（1.0 前奏）→ 1.0.x → 1.1.0 → 1.2.0 → 1.3.0，跨越 1.0 稳定线。
- `pi-agent-core@1.3.0` 依赖 `pi-ai@1.3.0`，两者同步升级保持依赖树单份。
- 两包 engines 均为 `>=22.19.0`，与现状一致，环境要求不变。

与以往升级不同，本次跨 1.0 含两处**架构级破坏性变化**，需要业务代码迁移：

1. **[0.99.0] images API 统一进 `Provider`/`Models`**：`ImagesModels` 独立集合移除（`createImagesModels()` / `createImagesProvider()` / `builtinImagesModels()` / `ImagesProvider` 等全部删除），图片模型成为带 `type: "image"` 的 `ImageModel`，与 chat 模型同库；生成走 `models.generateImages()`（provider-resolved auth）。
2. **[0.86.0–1.3.0] transcript system messages**：system prompt 与工具声明从 `Context` 独立字段迁移到 transcript 内的 system messages；`AgentState.systemPrompt` 变为从 transcript 重放的 readonly getter；`StreamFn` 的 context 参数从 `Context` 变为 branded `TranscriptContext`（仅 `messages`，无 `systemPrompt`/`tools` 字段）。

## Spherse 消费面审计

- pi-agent-core：运行时 import 仅 `Agent`（`agent-assembly.ts:1`）；其余全部 type-only（`AgentTool` 约 30 处、`AgentEvent`/`AgentMessage`/`StreamFn`/`Agent` 类型）。
- pi-ai 运行时符号：`createProvider`、`builtinModels`（保留）、`builtinImagesModels`（**已删除**）、`openAICompletionsApi`（`api/openai-completions.lazy`，保留）、`createImagesProvider`（**已删除**）、`envApiKeyAuth`（保留）；其余 import 为类型（`ImagesModels` / `MutableImagesModels` / `ImagesProvider` / `ImagesModel` **已删除**，`ProviderImagesOptions` 保留为 `ImagesOptions & Record<string, unknown>`）。
- 持久化面：session 消息经事件日志（`assistant/message` / `user/message` / `tool/result`）持久化并 `deriveMessages` 重建，**事件流不含 system 消息**，存储格式不受影响；`SPHERSE_IMAGE_MODEL`（`provider/modelId` 格式）为已发布环境变量，`openai/*`、`zhipu/*` 取值必须继续可用。

## 上游变更影响分析（仅列与 Spherse 有交集者）

| 变更 | 影响 | 处置 |
|---|---|---|
| **[0.99.0] images 统一**（见上） | `catalog.ts` 维护双集合、`zhipu-images.ts` / `openai-images.ts` 用 `createImagesProvider`、`generate-image.ts` 走 `ImagesModels.getModel/generateImages` | 方案 A（下文） |
| **[0.86.0] `StreamFn`/`ProviderStreams` 入参 `Context` → `TranscriptContext`** | `StreamFn` 的类型引用自动跟随；`web-search` decorator 读 `context.tools`（字段已不存在，编译失败且行为缺失） | 方案 B-4 |
| **[0.86.0] `ToolResultMessage` 条件类型化、`ToolCall.arguments`/`details` 限 JSON 值** | 项目工具的 `details` 均为 JSON 可序列化对象 | 编译期验证，预期无需改动 |
| **[1.1.0] stream 函数必须返回 `AssistantMessageEventStream`** | `models.streamSimple` 返回值即此类型 | 无需改动 |
| **[1.3.0] 移除 `AssistantMessageFrame*`** | 全仓零引用 | 无需改动 |
| **[1.0.3] Azure provider 改名 `azure`** | Spherse 未启用 azure | 无需改动 |
| **[0.99.0] `AgentState.systemPrompt` readonly + transcript 重放** | `agent-runner.ts:403`（reload）、`mcp/index.ts:82-85`（MCP block 注入）两处运行时写入；`syncBufferFromLog` 重赋 `deriveMessages` 输出会**抹掉 leading system message** | 方案 B |
| **[0.99.0] `Agent` 构造：`initialState.systemPrompt` + `tools` seed 进 leading system message**；`set messages` 仅浅拷贝 | `buildAgent` 的 `initialState` 用法兼容（官方保留） | 无需改动 |
| **[1.3.0] agent-loop 每次请求前把 `state.tools` 与 transcript 工具声明的 diff 写入 pending system message（`toolsAdded`/`toolsRemoved`）** | `state.tools = ...` 赋值语义保留，声明自动化 | MCP 合并逻辑只需继续赋 `state.tools` |
| **[0.99.x] builtin 目录自带 OpenRouter 图片模型（`openrouter-images` api + 内置实现）** | 原先 `builtinImagesModels()` 提供的 OpenRouter 图片能力由统一 builtin 集合直接覆盖；图片模型选择器将新增 FLUX 系列等条目 | 预期行为（用户获得新模型），PR 描述列出 |
| **[1.1.0] `AssistantMessage.durationMs` / `ToolResultMessage.durationMs` 增量字段** | 类型增量，事件透传 | 无需改动 |
| 模型目录刷新（含新增 GPT-6 Sol/Luna、Claude Haiku 5.5、Opus 5.5 等，移除若干） | 用户可见模型列表变化；被移除模型由 `resolveModelWithFallback` 回落 | 无需改动，PR 描述列出 |

## 方案设计

### A. images 迁移到统一 Provider/Models

**核心问题：provider id 冲突。** 统一集合按 id upsert（`MutableModels.setProvider` 整体替换），自建 OpenAI 图片 provider 若沿用 id `"openai"` 会替换掉内置 OpenAI chat provider（OAuth、动态目录全部丢失）。而 `SPHERSE_IMAGE_MODEL=openai/gpt-image-1` 是已发布格式，不能改 id。

**设计：**

1. `zhipu-images.ts`：`createZhipuImagesProvider()` 改用 `createProvider({ id: "zhipu", name: "智谱", auth, models: [ImageModel…], images: { "zhipu-images": { generateImages } } })`；模型记录加 `type: "image"`；类型 `ImagesModel` → `ImageModel`、`ImagesProvider` → `Provider`。zhipu 与内置集合无冲突，直接 `setProvider`。
2. `openai-images.ts`：改类型与 `type: "image"`；导出 `withOpenaiImages(base: Provider): Provider` —— 包装内置 openai provider（对象委托）：`getAllModels()` 返回 `[...base 全量, ...OpenAI 图片模型]`，`generateImages` 调用自建实现，其余成员透传 base（auth 用 base 的；`Models.generateImages` 的 `applyAuth` 对显式 `options.apiKey` override 直接生效，`SPHERSE_IMAGE_API_KEY` 路径不变）。
3. `catalog.ts`：
   - 删除 `imagesModels` 集合与 `getImagesModels()`；
   - constructor：`builtinModels()` 后 `setProvider(createZhipuImagesProvider())`，再取 `getProvider("openai")` 包装替换；
   - `getImageSupportedProviders()`：遍历统一集合 `getProviders()`，`getModelsOfType("image", provider.id)` 非空才进目录（openrouter 现在自带图片模型，自然出现）。
4. `model-providers/index.ts`：`getImagesModels()` 改为 `getImageModels(): Models`（返回统一集合，供 generate-image 用）。
5. `generate-image.ts`：`getModel(provider, id)` → `getModelOfType("image", provider, id)`；`generateImages` 调用签名不变。
6. 测试：`generate-image.test.ts` mock 改 `getModelOfType`；`__tests__/zhipu-images.test.ts` / `__tests__/openai-images.test.ts` 断言加 `type: "image"`；`model-providers.test.ts` 的 `builtinImagesModels` mock 随迁移移除；`compaction-summarize.test.ts` 对 `context.systemPrompt`/`context.tools` 的断言改为检查 normalize 后的 messages；`agent-runner.test.ts:410`、`session-manager.test.ts:771` 等 messages fixtures 适配 leading system 存在。

### B. transcript system message 迁移

**语义基线**（源自 pi-agent-core 1.3.0 `agent.js` / agent-loop 源码审计）：

- `Agent` 构造时把 `initialState.systemPrompt` + `tools` 写入 leading system message（`messages[0]`，含 `content` / `sections` / `toolsAdded`）。
- `state.systemPrompt` = `getCurrentSystemPrompt(messages)`（重放全部 system messages 的文本）。
- 每次请求：`convertToLlm(state.messages)` → `normalizeContext` → `TranscriptContext`（纯 messages）→ StreamFn。**system messages 必须经 convertToLlm 保留，否则 prompt 丢失。**
- agent-loop 自动将 `state.tools` 与 transcript 工具声明的 diff 声明为 pending system message 的 `toolsAdded`/`toolsRemoved`。

**迁移点：**

1. `agent-assembly.ts` `convertToLlm`：role filter 从「user/assistant/toolResult」放宽为「system/user/assistant/toolResult」。
2. `capabilities/attachments/projector.ts`：`STRIP_ROLES` 白名单加入 `"system"`——该 projector 是「白名单保留」语义（不在集合内的 role 直接丢弃），是所有 agent 无条件注册的必经路径，不加入则 system message 在 projector 层被剥掉、prompt 在**每次请求**上丢失。加入后 system 消息走原样 push 分支（user 剥离逻辑不受影响）；sanitizer（事件层）只改写 user 消息，无需改。
3. 新 util（`session/system-message.ts`），边界语义固定：
   - `retainLeadingSystem(current, next)`：`next[0]` 已是 system 时原样返回 next（不自作主张前置）；否则若 `current[0]` 为 system 则前置之；否则原样返回 next。`syncBufferFromLog` 重赋 `deriveMessages` 输出时调用，防止事件重放抹掉 prompt；
   - `updateLeadingSystemContent(agent, fn)`：`messages[0]` 为 system 时替换其 `content` 为 `fn(content)`（immutably 重赋）；无 leading system 时以 `fn("")` 创建新 leading（reload 前提下理论上恒存在，创建分支兜底）。服务于：
     - `agent-runner.ts` `applyReload`：`updateLeadingSystemContent(agent, () => systemPrompt)`（重建后的完整 prompt 覆盖）；
     - `mcp/index.ts` `beforeTurn`：`updateLeadingSystemContent(agent, (c) => c.replace(MCP_BLOCK_RE, "") + block)`（与旧字符串操作逐字等价，MCP 标记注释保持自定界）；
   - `withoutLeadingSystem(messages)`：剥离 leading system，供 token 估算复用（见迁移点 8）。
4. `web-search` decorator（`capabilities/web-search/index.ts`）：`TranscriptContext` 无 `tools` 字段，改为 `getCurrentTools(context.messages)`（pi-ai 导出）解析当前工具；需要隐藏时写本地 util `withoutTool(messages, name)`——解析当前工具集、过滤后重写 leading system message 的 `toolsAdded` 并剥离其后 system messages 的 `toolsAdded`/`toolsRemoved` 声明（Spherse 从不 mid-conversation 手写工具声明，后续声明只来自 agent-loop 的 state.tools diff，重放语义在过滤后自洽）。
5. `compaction/summarize.ts`：`streamFn(model, context, …)` 的 context 需要 `TranscriptContext`（branded，普通对象字面量无法通过类型）；改用 pi-ai `normalizeContext({ systemPrompt, tools, messages })` 构造（行为等价：systemPrompt 字段折叠为 leading system message；systemPrompt 取自 `agent.state.systemPrompt` getter）。`foldMessages` 输入来自 `deriveMessageEntries`（无 system），不受 convertToLlm 放行影响。
6. `time-perception` decorator：`{ ...context, messages }` spread 保留 brand 与只改 user 消息 → 无需改动（编译验证）。
7. `getTurnContext()`（debug 导出）：`systemPrompt` 读 getter（重放值）不变；`messages` 含 leading system（信息更完整，wire 真实视图）。
8. **事件管道过滤 system 消息事件**：agent-loop 在工具集 diff 时会 emit 空 content 的 system message 的 `message_start`/`message_end` 事件（`declareToolChanges` 产物），经 `agent.subscribe(dispatch)` 直通 WS。为保持 wire 与旧版等价（旧版不存在这些事件），在 `agent-runner.ts` 的事件 dispatch 入口丢弃 `message_*` 事件中 `role === "system"` 的条目（持久化层本就只认 assistant/toolResult，不受影响；前端 entry-reducer 对 system 是 no-op，过滤后无需依赖该隐性容忍）。
9. **`getStatus()` token 口径**：迁移后 `state.messages[0]` 即 leading system（content = system prompt），与 `state.systemPrompt` 参数同文本，`readCurrentTokens` 的 fallback 路径（首 turn 无 usage）会双计 prompt。`agent-runner.ts:347` 改为 `readCurrentTokens(withoutLeadingSystem(state.messages), state.systemPrompt)`，与旧版口径逐字一致；compaction transform（事件日志派生，无 system）与 session-manager 冷路径口径不变。

### C. 不做的事

- 不使用 `SystemMessage.sections` / mid-conversation system message 做增量 prompt 更新（保持与旧版「每次请求完整重建」字节等价，prompt cache 行为不变）；sections 增量优化留作后续独立迭代。
- 不为未发布格式写迁移：事件日志格式不变（system message 不入事件流）；旧 session 重放路径经 `retainLeadingSystem` 在内存中补 leading system，落盘数据无变化。

## 测试与验证

- 单测：core 全量（重点 `agent-runner` / `mcp-merge` / `compaction*` / `generate-image` / `model-providers*` / `fold`）；server / app / desktop / i18n 契约与回归。
- 编译链：`npm run lint` → `npm run build` → `npm run typecheck`（TranscriptContext brand、ToolResultMessage 条件类型在此暴露）。
- 行为等价断言：reload 后 `state.systemPrompt` 反映新 prompt；MCP block 注入/移除后 prompt 文本与旧版一致；无 key 时 wire 上 tools 无 `web_search`；`SPHERSE_IMAGE_MODEL=openai/*`、`zhipu/*` 解析与生成路径可用；wire / 事件日志中不出现 system 消息事件；首 turn（无 usage fallback）token 估算不双计 prompt。
- E2E 按影响面选型：聊天流（chat-streaming / chat-retry）走 mock server 回归，覆盖 wire 层无 system 事件的隐性契约。

## 风险

| 风险 | 缓解 |
|---|---|
| convertToLlm 放行 system 后，某些消费方意外收到 system 消息 | 持久化层只认 assistant/toolResult 事件；WS/日志侧由迁移点 8 显式过滤 system 事件；`getTurnContext` 导出为 debug 视图，接受含 leading system |
| `withOpenaiImages` 包装遗漏 Provider 成员 | 用显式委托实现（不 spread class 方法风险），编译期 `Provider` 接口全覆盖；单测验证 chat 流 + 图片流共存 |
| web-search `withoutTool` 重写与 agent-loop 工具 diff 声明交互 | agent-loop diff 基于 `getCurrentTools(transcript)` vs `state.tools`：decorator 只改 wire transcript，不改 state.tools，每次请求重新 diff，无累积漂移；单测锁定 |
| 上游适配器层（anthropic-messages 等）无真实请求回归 | 与 0851 升级同一立场：mock 契约 + 上游 CLI 主路径承担，发版后观察 |
