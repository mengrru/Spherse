# @earendil-works/pi-agent-core Harness 接入调研

## 背景

本次调研目标：查看 `@earendil-works/pi-agent-core` 最新版本的 harness 实现，判断 Spherse 是否适合接入。

调研时间：2026-06-05

调研版本：`@earendil-works/pi-agent-core@0.78.1`

当前项目版本：`@mariozechner/pi-agent-core@^0.72.1`

结论摘要：当前不建议直接把 Spherse 的 Agent runtime 整体迁移到 harness。更合适的路径是先升级/改名到 `@earendil-works/pi-agent-core` 的普通 `Agent` API，保持现有 SQLite session 和前端事件模型稳定；等需要会话树、分支导航、自动 compaction、统一技能加载或 JSONL session repo 时，再以 feature 形式评估引入 harness 的部分能力或适配层。

## 信息来源

- npm metadata：`npm view @earendil-works/pi-agent-core version dist.tarball repository homepage description --json`
- npm tarball：`@earendil-works/pi-agent-core@0.78.1`
- 重点读取文件：
  - `package/dist/index.d.ts`
  - `package/dist/agent.d.ts`
  - `package/dist/types.d.ts`
  - `package/dist/harness/agent-harness.d.ts`
  - `package/dist/harness/types.d.ts`
  - `package/dist/harness/session/session.d.ts`
  - `package/dist/harness/session/jsonl-repo.d.ts`
  - `package/dist/harness/env/nodejs.d.ts`
  - `package/dist/harness/skills.d.ts`
  - `package/README.md`
- 本项目重点读取文件：
  - `packages/core/package.json`
  - `packages/core/src/engine.ts`
  - `packages/core/src/store/session.ts`
  - `packages/core/src/tools/index.ts`
  - `packages/server/src/ws-chat.ts`
  - `packages/app/src/lib/types.ts`
  - `packages/app/src/features/chat/hooks/useChatSession.ts`
  - `docs/official/architecture.md`

## 当前 Spherse 接入现状

### 依赖与运行时

`packages/core/package.json` 当前依赖：

- `@mariozechner/pi-agent-core`: `^0.72.1`
- `@earendil-works/pi-ai`: `^0.78.0`
- `@sinclair/typebox`: `^0.34.0`

`packages/core/src/engine.ts` 使用方式：

- 从 `@mariozechner/pi-agent-core` 导入 `Agent`、`AgentEvent`、`AgentTool`。
- 从 `@earendil-works/pi-ai` 导入 `streamSimple`。
- 每个 Spherse session 对应一个内存中的 `Agent` 实例，存放在 `activeSessions: Map<string, Agent>`。
- `Engine.buildAgent()` 组装 system prompt、model、thinkingLevel、tools，然后 `new Agent({ initialState, sessionId, streamFn })`。
- `restoreSession()` 通过 `agent.state.messages = sessionStore.getSessionMessages(sessionId)` 恢复线性消息历史。
- `sendMessage()` 订阅 agent events，并在 `message_end` 时把完整 message 写入 SQLite。
- `abortSession()` 直接调用 `agent.abort()`。

### Session 存储模型

`packages/core/src/store/session.ts` 目前是简单 SQLite 线性模型：

- `sessions`: `id`, `agent_id`, `title`, `created_at`, `updated_at`, `status`
- `messages`: `id`, `session_id`, `role`, `content`, `timestamp`
- message 的 `content` 存储完整 JSON string。
- 恢复历史时按 `timestamp ASC` 返回 message array。

这套模型服务于当前聊天 UI：前端只需要按顺序重建 user/assistant/toolResult 消息。

### 事件与前端消费

`packages/server/src/ws-chat.ts` 把 `Engine.sendMessage()` 收到的 agent event 原样通过 WebSocket 发给 renderer，并在完成后额外发送 `{ type: "agent_end_done" }`。

`packages/app/src/lib/types.ts` 和 `useChatSession.ts` 当前只消费：

- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `agent_end_done`
- `error`

前端依赖 `tool_execution_update.partialResult.details` 渲染 `render_card` 的 HTML card，也依赖历史 `assistant.content[].type === "toolCall"` 与独立 `toolResult` message 重建折叠 tool call UI。

### 工具实现

`packages/core/src/tools/index.ts` 当前返回 `Record<string, AgentTool<any>>`，包含：

- `read_file`
- `write_file`
- `edit_file`
- `list_files`
- `search_content`
- `append_changelog`
- `render_card`
- `load_skill`

项目约定所有工具使用工厂函数模式，参数 schema 来自 `@sinclair/typebox`。

当前已有 `FileWriteMutex` 解决 pi-agent-core 默认 parallel tool execution 下同文件并发写入的问题。

## 最新 @earendil-works/pi-agent-core 概况

### 包信息

`@earendil-works/pi-agent-core@0.78.1`：

- npm description：`General-purpose agent with transport abstraction, state management, and attachment support`
- repository：`https://github.com/earendil-works/pi`，目录 `packages/agent`
- Node engine：`>=22.19.0`
- dependencies：
  - `@earendil-works/pi-ai`: `^0.78.1`
  - `ignore`: `7.0.5`
  - `typebox`: `1.1.38`
  - `yaml`: `2.9.0`

### 导出内容变化

0.72.1 的 `dist/index.d.ts` 只导出：

- `agent`
- `agent-loop`
- `proxy`
- `types`

0.78.1 的 `dist/index.d.ts` 额外导出 harness 相关模块：

- `harness/agent-harness`
- `harness/compaction/*`
- `harness/messages`
- `harness/prompt-templates`
- `harness/session/*`
- `harness/skills`
- `harness/system-prompt`
- `harness/types`
- `harness/utils/*`

普通 `Agent` API 仍存在，事件名也与当前 Spherse 使用的核心事件基本兼容。

## Harness 实现能力

### AgentHarness 核心 API

`AgentHarness` 构造参数：

- `env: ExecutionEnv`
- `session: Session`
- `tools?: TTool[]`
- `resources?: { skills?: Skill[]; promptTemplates?: PromptTemplate[] }`
- `systemPrompt?: string | callback`
- `getApiKeyAndHeaders?: (model) => Promise<{ apiKey; headers? } | undefined>`
- `streamOptions?: AgentHarnessStreamOptions`
- `model: Model<any>`
- `thinkingLevel?: ThinkingLevel`
- `activeToolNames?: string[]`
- `steeringMode?: QueueMode`
- `followUpMode?: QueueMode`

主要方法：

- `prompt(text, { images? })`
- `skill(name, additionalInstructions?)`
- `promptFromTemplate(name, args?)`
- `steer(text, { images? })`
- `followUp(text, { images? })`
- `nextTurn(text, { images? })`
- `appendMessage(message)`
- `compact(customInstructions?)`
- `navigateTree(targetId, options?)`
- `setModel(model)` / `getModel()`
- `setThinkingLevel(level)` / `getThinkingLevel()`
- `setTools(tools, activeToolNames?)`
- `setActiveTools(toolNames)`
- `setResources(resources)`
- `setStreamOptions(streamOptions)`
- `abort()`
- `waitForIdle()`
- `subscribe(listener)`
- `on(type, handler)`

### Harness 事件与 hook

`AgentHarnessEvent` 是普通 `AgentEvent` 加上 harness 自有事件。新增事件包括：

- lifecycle / queue：`queue_update`, `save_point`, `abort`, `settled`
- prompt/context/provider：`before_agent_start`, `context`, `before_provider_request`, `before_provider_payload`, `after_provider_response`
- tool hook：`tool_call`, `tool_result`
- session：`session_before_compact`, `session_compact`, `session_before_tree`, `session_tree`
- runtime state：`model_update`, `thinking_level_update`, `tools_update`, `resources_update`

`on(type, handler)` 的 handler 可以返回结果影响运行：

- `before_agent_start` 可改写 messages/systemPrompt。
- `context` 可改写传给模型的 messages。
- `before_provider_request` 可 patch stream options。
- `before_provider_payload` 可改写 provider payload。
- `tool_call` 可 block tool call。
- `tool_result` 可 patch tool result 或 terminate。
- `session_before_compact` 可取消或提供自定义 compaction。
- `session_before_tree` 可取消 tree navigation 或提供 branch summary。

这比当前 Spherse 只做 `Agent.subscribe()` 事件转发强很多，但也意味着 runtime ownership 会从 Spherse `Engine` 进一步转移到 harness。

### Session 树模型

Harness session 不是线性 message list，而是 `SessionTreeEntry` 树：

- 每个 entry 有 `id`, `parentId`, `timestamp`。
- `SessionStorage` 维护 active `leafId`。
- `Session.buildContext()` 根据当前 leaf 到 root 的路径构建当前上下文。
- 支持 `moveTo(entryId)`，并可在跳转时写入 branch summary。
- entry 类型包含 `message`, `thinking_level_change`, `model_change`, `active_tools_change`, `compaction`, `branch_summary`, `custom`, `custom_message`, `label`, `session_info`, `leaf`。

内置 repo/storage：

- `MemorySessionRepo` / `MemorySessionStorage`
- `JsonlSessionRepo` / `JsonlSessionStorage`

`JsonlSessionRepo` 依赖 harness 的 `FileSystem` 接口，以目录和 JSONL 文件保存 session，并支持 `create/open/list/delete/fork`。

### ExecutionEnv

Harness 抽象了文件系统和 shell：

- `FileSystem`: `readTextFile`, `writeFile`, `appendFile`, `listDir`, `exists`, `createDir`, `remove`, `createTempFile` 等。
- `Shell`: `exec(command, options)`。
- 所有失败通过 `Result<T, FileError | ExecutionError>` 返回，接口要求实现不要 throw/reject。
- 内置 `NodeExecutionEnv`，但它只是 Node 环境能力封装，不包含 Spherse 当前工具的 project-root path safety、业务过滤、写入互斥等策略。

### Skills 与 prompt templates

Harness 提供：

- `loadSkills(env, dirs)`：递归加载 `SKILL.md` 和根目录 `.md` skill，支持 ignore file，返回 diagnostics。
- `loadSourcedSkills(...)`：保留来源信息。
- `formatSkillInvocation(skill, additionalInstructions?)`。
- `formatSkillsForSystemPrompt` 相关 system prompt helper。

Spherse 当前已有 `SkillStore` + `load_skill` tool：

- skill 位于 `.spherse/skills/*/SKILL.md`
- Engine 构建 system prompt 时注入 skill catalog
- agent 通过 `load_skill` 工具加载完整内容

Harness 的 skills 能覆盖部分 Spherse 能力，但需要对现有 skill 数据结构、frontmatter 解析和 tool 行为做取舍。

### Compaction 与 branch summary

Harness 内置：

- context token 估算
- `shouldCompact`
- `prepareCompaction`
- `compact`
- `generateSummary`
- branch summary 生成
- session tree navigation 时的 branch summary

这对长期会话很有价值，但当前 Spherse 还没有明确的长上下文压缩、分支会话或时间线导航需求。

## 与 Spherse 的适配分析

### 适合保留现状的部分

以下能力目前 Spherse 自己实现得更贴近产品：

- 项目内 agent profile 解析与系统提示词组装。
- SQLite session 元数据和 message 持久化。
- WebSocket 事件透传和前端消息/工具调用渲染。
- 文件工具的 project-root path safety。
- 写文件工具共享 `FileWriteMutex`。
- `.spherse/skills` 的 catalog 注入和 `load_skill` tool。
- `render_card` 通过 tool update details 驱动前端 HTML card。

直接切换到 harness 会重复或替换这些能力，短期收益不明显。

### 可直接受益的部分

以下 harness 能力对 Spherse 有潜在价值：

- `context` hook：可把当前 `readContextFiles()` 和未来动态上下文注入做成运行期 hook。
- `tool_call` / `tool_result` hook：可统一做工具审计、权限控制、结果后处理。
- `before_provider_request` / `before_provider_payload`：适合后续 provider observability、headers、metadata、代理或调试。
- `setModel` / `setThinkingLevel` / `setActiveTools`：适合未来会话内切换模型、thinking level、工具开关。
- `compact()`：适合未来长会话压缩。
- session tree / `navigateTree()`：适合未来会话分支、回退、探索不同世界观方案。
- `loadSkills()`：可减少自维护 skill loader，但需要确认 frontmatter 兼容性和产品语义。

### 主要接入成本

1. 包名和 pi-ai 命名空间统一

当前 core 组合是 `@mariozechner/pi-agent-core` + `@earendil-works/pi-ai`。最新 agent-core 依赖 `@earendil-works/pi-ai@^0.78.1`，类型也引用 `@earendil-works/pi-ai`。建议先完成包名迁移，避免同一运行时混用不同 namespace 的类型。

2. Node 版本要求提高

`@earendil-works/pi-agent-core@0.78.1` 要求 Node `>=22.19.0`，旧包要求 `>=20.0.0`。Electron 和本地开发环境需要确认实际 Node/Electron embedded Node 版本满足要求。

3. TypeBox 包变化

最新 `AgentTool` 类型从 `typebox` 导入 `Static, TSchema`，当前项目工具 schema 使用 `@sinclair/typebox`。这很可能导致 TypeScript 类型不兼容。接入最新包时至少要做一种选择：

- 把工具 schema 从 `@sinclair/typebox` 迁移到 `typebox`。
- 或在工具 registry 边界做类型适配，但这会削弱类型安全。

鉴于 pi-agent-core 的 `AgentTool` 直接约束 `TParameters extends TSchema`，更稳妥的是迁移到 `typebox` 并更新项目编码规范。

4. Session 存储模型差异

Spherse 当前是 SQLite 线性消息表。Harness 是 session tree entry log，并通过 leaf 构建上下文。直接使用 harness 内置 repo 会带来：

- 需要从 SQLite 迁移到 JSONL，或实现一套 SQLite `SessionStorage` / `SessionRepo`。
- 前端历史消息 API 需要从 linear messages 兼容 session tree context。
- 删除/归档/list session 的语义要重新适配。
- 现有 `SessionInfo.agentId/title/status` 不在 harness 基础 metadata 中，需要扩展 metadata 或继续由 Spherse 外层维护。

5. Engine ownership 变化

当前 `Engine` 是 core 唯一门面。Harness 也有自己的 session、resources、tools、model、thinking、队列和事件 hook ownership。若整体接入，需要重新定义：

- `Engine` 是否只做 harness facade。
- session 生命周期由 `SessionStore` 还是 `AgentHarness` 管。
- skill/resource reload 由 `SkillStore` 还是 harness resources 管。
- model/defaultModel 更新走 `Engine.setDefaultModel()` 还是 `AgentHarness.setModel()`。

6. 前端事件面扩张

Harness 会发出更多事件。可以只转发现有 `AgentEvent`，但如果要利用 harness 自有事件，需要扩展 app `AgentEvent` union 和 `useChatSession` 处理逻辑。

### 普通 Agent 升级兼容性

如果不接 harness，只把旧包迁移到新包普通 `Agent`，迁移面相对可控：

- `Agent`、`AgentEvent`、`AgentTool` 仍存在。
- 核心事件名仍包括当前前端消费的 `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`。
- `AgentOptions` 仍支持 `initialState`, `streamFn`, `sessionId`, `toolExecution`, hooks 等。
- 0.78.1 新增 `prepareNextTurn` 等能力，但不强制使用。

主要仍需处理包名、Node 版本和 `typebox` 类型迁移。

## 接入方案选项

### 方案 A：不接 harness，仅迁移到最新普通 Agent

内容：

- `@mariozechner/pi-agent-core` 改为 `@earendil-works/pi-agent-core@^0.78.1`。
- `@earendil-works/pi-ai` 升到 `^0.78.1`。
- 更新 import。
- 处理 `typebox` / `@sinclair/typebox` 的工具 schema 类型兼容。
- 保持 `Engine`, `SessionStore`, WebSocket, 前端事件处理不变。

优点：

- 风险最小。
- 可消除新旧 namespace 混用。
- 为未来使用 harness 做前置依赖统一。

缺点：

- 暂时拿不到 harness 的 session tree、compaction、resources 等上层能力。

适用判断：推荐作为第一步。

### 方案 B：接入 harness，但保留 SQLite，自己实现 SessionStorage/Repo

内容：

- Engine 内部用 `AgentHarness` 替代 `Agent`。
- 为现有 SQLite 实现 harness `SessionStorage` / `SessionRepo`。
- 把 Spherse `SessionInfo` 与 harness session metadata 做双向映射。
- WebSocket 只转发兼容当前 UI 的事件，或渐进扩展 harness 自有事件。
- SkillStore、tools、systemPrompt 以 harness resources/systemPrompt callback 适配。

优点：

- 保留现有数据存储。
- 可以逐步获得 hook、compaction、tree navigation。

缺点：

- 实现成本高，尤其是 tree entry、leaf、fork、branch context 与现有 messages 表的映射。
- 如果暂时不做会话分支和 compaction，大部分工作是在为未来能力付成本。

适用判断：只有在近期明确要做长会话压缩或会话分支时才值得。

### 方案 C：接入 harness 并切换到内置 JsonlSessionRepo

内容：

- 让 harness 管 session tree 和 JSONL 文件。
- Spherse 只保留 agent profile 和外层 session index，或迁移 session 存储位置。

优点：

- 最接近 upstream harness 设计。
- 最少自定义 harness session 层代码。

缺点：

- 破坏当前 SQLite session 存储架构。
- 需要数据迁移和兼容旧 session。
- Server/API/UI 都要重新适配 session list、history、delete/archive。

适用判断：当前不推荐。

### 方案 D：只复用 harness 独立 helper

内容：

- 继续使用普通 `Agent`。
- 按需引入 `loadSkills`, `formatSkillInvocation`, compaction helper 或 message conversion helper。

优点：

- 可局部试用上游能力。
- 不改变 runtime ownership。

缺点：

- helper 与 harness 类型耦合，仍需包名/Node/typebox 迁移。
- 可能形成半接入状态，后续维护边界要清晰。

适用判断：可作为方案 A 后的小步增强。

## 推荐结论

短期推荐：先做方案 A，不直接接 harness。

理由：

- 当前 Spherse 的核心需求是稳定的本地桌面 agent 对话、项目文件工具和 SQLite session 历史；普通 `Agent` 已满足。
- Harness 的最大价值在 session tree、compaction、branch summary、resources 和 hook 体系，但这些能力会显著改变 Spherse 的 session/runtime ownership。
- 现有前端和存储都是线性会话模型，直接接 harness 会带来高迁移成本。
- 最新普通 `Agent` API 与当前代码较兼容，先完成包名和类型统一能降低未来接 harness 的门槛。

中期建议：把 harness 作为未来 feature 的基础能力候选，而不是作为依赖升级的一部分。

可以进入 brainstorming 的方向：

- 是否需要“会话分支/回退/对比世界线”的产品能力。
- 是否需要长会话自动压缩和摘要可视化。
- 是否需要运行期权限 hook、工具审计、provider payload 调试。
- 是否需要把 skill 系统改为 upstream harness resources 模型。

## 建议的后续实施顺序

1. 依赖预研任务：验证 Electron/Node 版本是否满足 `>=22.19.0`。
2. 依赖迁移任务：从 `@mariozechner/pi-agent-core` 迁移到 `@earendil-works/pi-agent-core@^0.78.1`。
3. Schema 迁移任务：评估并迁移 `@sinclair/typebox` 到 `typebox`，或明确 adapter 边界。
4. Regression 验证：覆盖 chat streaming、tool execution、render_card、abort、restore session。
5. Harness feature brainstorming：围绕 session tree/compaction/tool governance 设计产品化接入点。

## 风险清单

- Node engine `>=22.19.0` 可能与 Electron runtime 或用户本地环境冲突。
- `typebox` 与 `@sinclair/typebox` 不兼容会影响所有 `AgentTool` 类型。
- 若直接接 harness，SQLite session schema 需要扩展或替换。
- Harness 自有事件扩张会影响 WebSocket event contract。
- `loadSkills()` 的 frontmatter/ignore 语义需要与 Spherse 当前 `SkillStore` 对齐。
- Compaction 和 branch summary 会引入额外 LLM 调用，需要 UI、成本、失败恢复策略。

## 最终判断

Spherse 适合关注并逐步吸收 `@earendil-works/pi-agent-core` harness 的能力，但当前不适合直接整体接入 harness。最稳妥的路线是先升级到新包普通 `Agent`，保留现有 Engine/SessionStore/UI 结构；当产品明确需要会话树、分支导航或自动 compaction 时，再为 harness 设计专门的适配方案。
