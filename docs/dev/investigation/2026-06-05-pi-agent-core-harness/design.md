# pi-agent-core Harness 接入设计

## 目标

基于 `README.md` 的调研结论，本设计定义 Spherse 对 `@earendil-works/pi-agent-core` 最新版本的接入策略。

核心目标：先完成 agent-core 包名和普通 `Agent` API 迁移，保持现有 Spherse runtime、SQLite session、WebSocket 事件和前端聊天体验稳定；暂不整体接入 harness，但为后续会话树、compaction、tool governance 等能力预留清晰边界。

## 需求对齐

本阶段要解决的问题不是“立即使用 harness 的全部能力”，而是决定如何安全地向最新上游演进。

已确认约束：

- 当前 `Engine` 是 core 层唯一运行时门面，server 和 app 不直接操作 pi-agent-core。
- 当前 session 是 SQLite 线性消息历史，不是 harness 的 session tree。
- 当前前端只消费普通 `AgentEvent` 中的 streaming 和 tool execution 事件。
- 当前工具使用 `AgentTool` 工厂函数，参数 schema 仍来自 `@sinclair/typebox`。
- 最新 `@earendil-works/pi-agent-core@0.78.1` 要求 Node `>=22.19.0`，并使用 `typebox` 包。

## 非目标

本设计不包含：

- 不直接把 `Engine` 改造成 `AgentHarness` facade。
- 不迁移 SQLite session 到 harness JSONL session repo。
- 不实现 session tree、fork、branch summary UI。
- 不引入自动 compaction。
- 不重写 skill 系统为 harness resources。
- 不改变现有 WebSocket chat event contract。

这些能力保留为后续独立 feature 的 brainstorming/design 范围。

## 方案比较

### 方案 A：先迁移到最新普通 Agent

将 `@mariozechner/pi-agent-core` 替换为 `@earendil-works/pi-agent-core@^0.78.1`，继续使用普通 `Agent`。保留现有 `Engine`、`SessionStore`、tools、server WebSocket 和前端事件处理。

优点：迁移范围小，收益明确，能消除新旧 namespace 混用，并为未来 harness 接入铺路。

缺点：短期无法获得 harness session tree、compaction、resources 等能力。

### 方案 B：用 AgentHarness 替换 Engine 内部 Agent，并自实现 SQLite SessionStorage

保留 SQLite，但实现 harness session storage/repo 适配层，让 `Engine` 内部使用 `AgentHarness`。

优点：可以保留现有存储并逐步使用 harness hooks。

缺点：需要把线性 messages 映射到 session tree entry/leaf 模型，复杂度高；若不立即做分支或 compaction，收益不足。

### 方案 C：整体切换到 harness JSONL session repo

让 harness 管 session tree 和 JSONL 文件，Spherse 外层只保留 agent profile 和必要索引。

优点：最接近上游 harness 设计。

缺点：破坏现有 SQLite 架构，涉及数据迁移、API 变更和前端历史重建，风险最高。

## 推荐方案

推荐采用方案 A。

理由：

- 最新普通 `Agent` API 与当前使用方式基本兼容，迁移可控。
- 当前产品尚未要求会话分支、长上下文压缩或 harness resources，因此不应提前承担 session tree 迁移成本。
- 保留 `Engine` 作为唯一门面，能避免 server/app 直接耦合上游 harness 类型。
- 先完成 namespace、Node engine、TypeBox 兼容问题，是未来任何 harness 接入的前置条件。

## 设计细节

### 依赖迁移

`packages/core` 依赖调整：

- 移除 `@mariozechner/pi-agent-core`。
- 新增 `@earendil-works/pi-agent-core@^0.78.1`。
- 将 `@earendil-works/pi-ai` 升级到与 agent-core 匹配的 `^0.78.1`。
- 评估并迁移 schema 依赖到 `typebox`，或者在一个明确的工具类型适配边界内处理兼容。

首选做法是迁移工具 schema 到 `typebox`，因为最新 `AgentTool` 类型直接依赖 `typebox` 的 `TSchema` 和 `Static`。

### Engine 边界

`Engine` 继续维护：

- `activeSessions: Map<string, Agent>`。
- `createSession()` / `restoreSession()` / `sendMessage()` / `abortSession()`。
- system prompt 组装。
- profile tools 到 concrete `AgentTool[]` 的解析。
- `SessionStore` 持久化。

本阶段只更新 import 来源和必要类型，不改变 `Engine` 对 server 暴露的方法签名。

### Session 策略

继续使用现有 SQLite 线性存储：

- `message_end` 时写入完整 message。
- `restoreSession()` 时恢复 `agent.state.messages`。
- 历史 API 返回线性 message array。

不引入 harness `Session`、`SessionStorage`、`JsonlSessionRepo`。后续如果要做 session tree，应新增独立设计，优先考虑 SQLite-backed `SessionStorage`，而不是直接迁移到 JSONL。

### 工具策略

工具工厂函数和 registry 保持不变：

- `createToolsForProject(...)` 继续返回 name 到 `AgentTool` 的映射。
- `FileWriteMutex` 继续由 `write_file`、`edit_file`、`append_changelog` 共享。
- `render_card` 继续通过 `tool_execution_update` 传递 card details。

需要变更的仅是类型来源和 schema 包。如果迁移到 `typebox`，应一次性更新所有工具 schema import，避免混用两套 TypeBox 类型。

### WebSocket 和前端策略

server 继续原样转发普通 `AgentEvent`。

前端 `AgentEvent` union 暂不加入 harness 自有事件。这样可以保证：

- streaming 文本展示不变。
- tool call 折叠展示不变。
- `render_card` 展示不变。
- `agent_end_done` 兼容逻辑不变。

### Harness 预留边界

虽然本阶段不接 harness，但应记录未来接入点：

- tool governance：未来可用 harness `tool_call` / `tool_result` hook 统一权限和审计。
- compaction：未来可用 harness compaction helpers，但需要 UI、成本和失败恢复设计。
- session tree：未来如果做“世界线分支/回退/对比”，再设计 SQLite-backed session tree。
- skills：未来可比较 `SkillStore` 与 harness `loadSkills()`，决定是否替换 loader。

这些能力都不应在依赖迁移任务中顺手实现。

## 数据流

迁移后数据流保持现状：

1. App 通过 WebSocket 发送用户消息到 server。
2. Server 调用 `Engine.sendMessage(sessionId, message, onEvent)`。
3. Engine 找到 active `Agent`，订阅 events。
4. `Agent.prompt()` 产生普通 agent events。
5. Engine 在 `message_end` 写入 SQLite。
6. Server 转发 event 到 app。
7. App 根据 `message_update`、`message_end`、tool events 更新聊天 UI。

## 错误处理

- 依赖升级后若 Node engine 不满足，应在实施前阻断并升级运行环境，而不是绕过 engine 要求。
- 若 `typebox` 迁移导致工具类型不兼容，应优先修正 schema import，不使用 `any` 扩散到工具实现内部。
- 若 agent event payload 有细微变化，应在 app `AgentEvent` 类型和 `useChatSession` 中做最小兼容修正。
- 若 provider stream 类型不兼容，应优先保持 `streamSimple` 与 agent-core 使用同一 `@earendil-works/pi-ai` 版本。

## 测试与验证

实施方案 A 时至少验证：

- `npm run build --workspace=packages/core`
- `npm test --workspace=packages/core`
- `npm test --workspace=packages/app`
- 手动或集成验证一次 chat streaming。
- 验证至少一个读工具和一个写工具调用。
- 验证 `render_card` 的 `tool_execution_update` 仍能被前端识别。
- 验证 session restore 后历史消息和 tool call 折叠仍正常。
- 验证 abort 仍能停止当前 run。

## 验收标准

- core 不再依赖 `@mariozechner/pi-agent-core`。
- core 使用 `@earendil-works/pi-agent-core` 的普通 `Agent`、`AgentEvent`、`AgentTool`。
- `@earendil-works/pi-ai` 与 agent-core 版本匹配。
- 工具 schema 类型与最新 `AgentTool` 兼容。
- 现有 chat、tool execution、render card、session restore 行为不回退。
- 没有引入 harness session tree、JSONL repo 或 app 事件契约变更。

## 后续可选设计

依赖迁移稳定后，可分别为以下能力创建独立 design：

- 会话分支和世界线导航。
- 长会话自动 compaction。
- tool permission / governance hook。
- provider request observability。
- skill loader 与 harness resources 合并。

## 自检结论

本设计聚焦单一迁移目标，没有要求一次性接入 harness。设计明确保留现有 Engine、SQLite session、WebSocket 和前端事件边界，同时列出未来 harness 能力的独立接入方向。当前没有待定项、占位符或与调研结论冲突的内容。
