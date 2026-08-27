# Capability 能力模块

> 覆盖：capability 的贡献点、注入的可见环境、运行时的聚合与组合机制——即新增一个能力可触及的一切接入面。
> 内核结构与装配顺序见 [core.md](core.md)；写新能力的包级守则与步骤清单见 `packages/core/README.md`「增加能力的原则」，本文不重复。
> 各能力的业务语义不在本文展开：见能力目录源码与 `docs/dev/` 对应 feature 文档。

## 能力一览

`defaultCapabilities`（`capabilities/builtin.ts` + `factory.ts`）注册的全部能力：

| 能力 | 主要贡献 |
|---|---|
| `fs` | 文件读写/编辑/搜索/移动/复制/生图工具 |
| `skill` | `load_skill` 工具 + skill catalog block（按 name 去重合并，agent-level > `.spherse/skills` > `.agents/skills` > builtin） |
| `changelog` | `append_changelog` 工具 |
| `render` | `render_card` 工具 |
| `agent-mgmt` | `manage_agent` 工具（写 action 经审批） |
| `interaction` | `run_command`（逐次审批）、`ask_user`（问答门） |
| `project-config` | `manage_project_config` 工具 |
| `data` | `read_data` / `query_data` / `mutate_data` 工具（`*.data.json`） |
| `trigger` | `emit_trigger_event` / `manage_trigger` 工具 + `TriggerManager` / `TimerService` 调度 |
| `mcp` | MCP server 连接、工具运行时合并、`<mcp-context>` 注入 |
| `attachments` | 图片等附件处理器 |
| `compaction` | 上下文压缩（afterTurn 计划、`compaction/applied` 重启点） |
| `time-perception` | `<time>` 感知前缀（streamDecorator） |
| `memory` | `memory_save` / `memory_recall` + `<memory>` block（per-agent JSONL） |

## 贡献点（Capability 接口）

每个贡献点 = 一个被运行时在固定时机消费的扩展槽：

| 成员 | 消费时机与方式 | 典型用途 |
|---|---|---|
| `id` | 标识；ProjectRuntime 按 id 查找能力（如 trigger）、日志上下文 | — |
| `init(services)` | 装配时调用一次，接收 `KernelServices` | 接线：保存 port / 注册全局 store |
| `tools(host)` | 会话装配时调用，聚合进 `toolMap` | 贡献 AgentTool |
| `contextBlocks(view)` | 构建 system prompt 时调用 | 注入知识块（`ContextBlock { kind, render() }`） |
| `turnHooks` | turn 生命周期回调（beforeTurn / afterTurn / onReload） | turn 级行为、事件追加、systemPrompt 追加 |
| `streamDecorators` | 包装出站请求流，洋葱组合（后注册者最外层） | 改写发给 LLM 的消息 |
| `contextProjectors` | 在 convertToLlm 内组合执行（角色过滤前），管线序 | 清洗 AgentMessage（如剥附件引用） |
| `previewTransforms` | 仅 debug turn-context 快照重放，不进 wire 路径 | 调试可视化 |
| `attachmentProcessors` | flatMap 汇入 `RuntimeDeps`，sendMessage 组装多模态消息时消费 | 新附件类型 |
| `eventMiddlewares` | 挂入 EventPipeline（log → capability middleware → 附件 sanitizer → 持久化翻译） | 事件改写/观察 |
| `pathRules` | 汇入 access 策略，注册规则优先于内置类别，自带完整读写裁决 | 能力私有路径 |
| `onAgentDeleted` | 删除 agent 时级联调用 | 清理 per-agent 状态 |
| `onAgentConfigChanged` | `dispatchAgentConfigChanged` 广播，kind 为 `"mcp" \| "tools" \| "profile"` | 失效缓存 / 重算 memo |
| `shutdown` | 项目关闭时调用 | 释放连接/句柄 |

## 可见环境（注入面）

能力不 import 运行时实例，一切依赖经参数注入：

- **`KernelServices`**（init 收到）：`projectRoot` / `metaDir` / `logger` / `fileWriteMutex` / `stores` / `session`
- **`ToolHost`**（tools 收到）：agentId / sessionId / profile / projectRoot / projectStore / fileWriteMutex / logger / stores / pathRules / toolCatalog / approvalGate / askGate——工具可见的全部环境
- **`SessionPort`**（能力反向触达会话的唯一入口）：createSession / restoreSession / sendMessage / abortSession / sessionExists；完成通知 = await sendMessage 的 Promise
- **`StoreRegistry`**：`register/get` 全局共享实例，`forAgent(agentId)` per-agent 作用域（Map 语义）。内核不自动清理——能力需在自己的 `onAgentDeleted` 回调里 `clearAgent`
- **支撑层**：`tools/`、`store/`、`access/`、`trigger/`、`mcp/`、`session/fold` 等模块可按需引用（含有状态实现体）；不得 import SessionManager / AgentRunner

## 聚合与过滤

- **工具**：会话装配时（`session/agent-assembly.ts`）遍历能力聚合 `toolMap`，再按 `profile.tools` 过滤——未声明的 agent 拿不到该工具
  - 同名工具后注册者静默覆盖先注册者；contextBlocks 合并序、turnHooks 链序、eventMiddlewares 序同样由注册顺序决定——**注册顺序是全局载荷语义**
  - `toolCatalog` 回填全量工具名（未过滤），`manage_agent` 的工具名校验消费它，新能力的工具自动被认识
- **危险工具**：经 `tools/with-approval.ts` 的 `withApproval` 包装（`run_command`、`manage_agent` / `manage_trigger` 写 action）：
  - execute 前经 `ApprovalGate` 请求人工确认
  - yolo agent（`profile.yolo`）的 approvalGate 为 undefined，审批静默跳过
- **MCP 是静态 toolMap 的唯一例外**：mcp capability 的 turnHooks 按**配置版本** memo，配置变更后下一 turn 自动重合并
  - 首 turn 前按 agent 连接 enabled 的 MCP server，发现的工具以 `mcp__{server}_{shortid}__{tool}` 命名追加进 `agent.state.tools`
  - 同时经 beforeTurn 向 systemPrompt 追加 `<mcp-context>` block（不走 contextBlocks 贡献点）
  - 配置变更经 `onAgentConfigChanged(agentId, "mcp")` bump 版本使 memo 失效

## 新增能力的接入面

新目录 `capabilities/<name>/` + 工厂函数返回 `Capability` + `defaultCapabilities` 一行注册。可触及的面：

- 贡献点按需实现，依赖经注入拿（见「可见环境」）
- 私有路径声明 `PathRule`；per-agent 状态走 `stores.forAgent` 并在 `onAgentDeleted` 清理
- **暴露扩展成员是真实接线模式**：能力可在返回对象上暴露接口之外的成员，由 `ProjectRuntime` 以 derived getter 转发、server 消费：
  - `TriggerCapability.manager` / `timerService` → `ProjectRuntime.triggerManager` / `timerService`
  - `McpCapability.manager` / `invalidate` → deleteAgent 级联清理与配置失效
  - `DataStore` 由 factory 创建、构造注入 data capability、经 `ProjectRuntime.dataStore` 暴露给 `/data/*` 路由
  - 新增此类能力需在 ProjectRuntime 补转发 getter
- 能力间共享代码放 `capabilities/shared/`（如 llm-policy 被 fs / data / render 共用）；能力目录之间不互相 import

两条验收红线（详见 `packages/core/README.md`）：

- **侵入面以 git diff 为验收**：新能力若需要改 tools / session / access 的既有文件，先检查是不是 kernel 接口缺贡献点——缺则在 kernel 补接口，不在消费方开洞
- **产品化是独立 feature**：app tool-registry、i18n 三语、presets 默认模板不塞进能力目录

## 契约

- **写入路径按来源分流**：
  - server 路由写项目文件 → `ProjectManager` 门面（见 [core.md](core.md)「数据边界」）
  - LLM 工具写 → `llmAccessPolicy` 断言 + 共享 `FileWriteMutex`
  - 能力私有状态文件 → 自己的 store 模块落盘（如 `MemoryStore`）
  - 任何路径不得自建 `FileWriteMutex`——装配点唯一实例全链路注入
- `pathRules` 仅作用于 LLM 端；capability 私有文件对 server 路由不可读写，如需开放经 PM 门面方法显式授权
- 运行时配置变更信号是 `onAgentConfigChanged`（当前生产仅 dispatch `"mcp"`，`"tools"` / `"profile"` 为预留）；profile 变更走热重载路径（见 [core.md](core.md)「生命周期」），能力经 `turnHooks.onReload` 感知
