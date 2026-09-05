# Core 层架构

> 覆盖：`@spherse/core` 的组合式架构、会话运行时、数据层与生命周期。
> 能力模块的横切说明见 [capabilities.md](capabilities.md)，访问策略与审批见 [security.md](security.md)。
> 包级编码守则见 `packages/core/README.md`，数据文件格式见 [../data-conventions.md](../data-conventions.md)。

## 全局图

```
factory.ts · assembleProject —— 唯一装配点
│
├─ ProjectStore          数据聚合根（config / skills / per-agent AgentStore）
│   └→ ProjectManager    数据访问门面（server 可见的唯一数据边界）
├─ DataStore             *.data.json 读写（与 fs 工具共享 FileWriteMutex）
├─ SessionManager        会话池 → AgentRunner（即会话对象，持有 SessionEventLog）
└─ capabilities[]        能力模块，经 init(services) 接线
│
ProjectRuntime           对外协调层，聚合以上全部
```

装配顺序：store → ProjectManager → SessionManager → capability `init(services)` → ProjectRuntime。
所有依赖在装配点构造完毕，运行期没有 setter 或 ref 缝合。

## 核心契约

- **唯一装配点**：`assembleProject`（`factory.ts`）是组合根。新增能力 = 新 capability 目录 + 装配点一行，不改中心文件（为什么见 [ADR-0003](../../dev/decisions/0003-single-assembly-point.md)）
- **依赖方向单向**：`kernel/` 只含类型与纯组合子、零 I/O；`capabilities/*` 不触达 SessionManager / AgentRunner 实例，只依赖 kernel 类型与支撑层（store 类型、fold 纯函数）；`AgentRunner` 对具体能力零 import（为什么见 [ADR-0002](../../dev/decisions/0002-capability-kernel.md)）
- **数据边界**：server 不得见到 store 实例。跨层数据访问一律经 `ProjectManager` 门面
- **导出收紧**：`index.ts` 只导出外部实际消费的符号；store 内部类（`AgentStore`、`SessionStore` 等）不外泄，包入口不导出 `ProjectStore`
- **写入串行**：一切会写文件的路径共享同一 `FileWriteMutex` 实例（装配点创建、全链路注入）
- **配置变更统一信号**：`onAgentConfigChanged(agentId, kind)`，kind 为 `"mcp" | "tools" | "profile"`。新的运行时配置变更复用同一信号，不做鸭子类型嗅探

## kernel（零 I/O）

`Capability` 接口定义能力可贡献的一切：

- 工具与上下文：`tools(host)`、`contextBlocks(view)`
- turn 参与点：`turnHooks`（beforeTurn / afterTurn / onReload）
- 流改写：`streamDecorators`（出站请求流，洋葱序）、`contextProjectors`（convertToLlm 前投影）、`previewTransforms`（仅 debug 快照重放，不进 wire 路径）
- 附件与事件：`attachmentProcessors`（贡献附件处理器）、`eventMiddlewares`（事件管线中间件）
- 路径与生命周期：`pathRules`、`onAgentDeleted`、`onAgentConfigChanged`、`shutdown`

窄 port 定义模块间唯一可见面：

- `SessionPort`：能力触达会话的入口（createSession / restoreSession / sendMessage / abortSession / sessionExists）
- `ToolHost`：工具可见的全部环境（项目、store、mutex、pathRules、toolCatalog、审批/问答门）
- `StoreRegistry`：含 `forAgent(agentId)` 作用域

`PathRule` 类型定义在 `access/path-category.ts`（语义归属 access），kernel 仅 type 引用，避免类型环。

## 会话运行时

- **SessionManager** 是纯 session 池：session map 生命周期、legacy 迁移、hot-reload 标记、`setDefaultModel` / `setSampling` 经 `RunConfigHolder` 单点派发。构造只收成品 `RuntimeDeps`，不自带默认装配；对外提供事件读取门面（`readSessionEventsAfter` / `getSessionLastSeq` / `subscribeSessionEvents`，内存日志优先、store 回落），server 侧 chat 重放经此消费、不触达 runner 内部
- **AgentRunner** 直接作为会话对象并执行 turn；事件经 `EventPipeline`（log → capability middleware → sanitizer → 持久化翻译）对外直播
- **SessionEventLog 是消息唯一真相**：user / assistant / tool result / turn 边界追加到 per-agent SQLite events 表，`deriveMessages(events)` fold 结果单向同步给 pi 的内存数组，内存可随时丢弃重建（为什么见 [ADR-0001](../../dev/decisions/0001-event-log-fold.md)）
  - 不变量：`seq` 在单个 session log 内从 0 连续，`open` 校验损坏即抛；`appendBatch` 落库失败回滚内存追加
  - restore 先 `repairLog` 为未闭合 turn 持久化补写合成 error toolResult 与 `turn/end(aborted)`（二次恢复幂等），再 fold
- **控制事件（重启点）**：`turn/retried`、`turn/withdrawn`、`compaction/applied`，restore 时按语义重建；WS 协议不受存储格式影响
  - withdraw：`turn/withdrawn {seq}` 锚定被撤回的 user message，fold 从日志推导废弃区间 `[seq, 本事件 seq)`；末轮已被 digest 覆盖（lastUserEvent.seq ≤ anchorSeq）时拒绝撤回
  - compaction：阈值触发时经 agent 自身 streamFn 生成 LLM 摘要——精确复刻请求前缀（systemPrompt + tools + fold 视图 + 追加摘要指令）命中 provider prompt cache；失败且 tokens ≤ 90% window 跳过本轮，> 90% 回退机械拼接
    摘要长度预算按压缩时 context tokens 的 5% 动态给定（clamp 1500–16000），同时约束摘要指令文本与 stream `maxTokens`（再与模型输出上限取 min）
    摘要来源以 `digestSource: "llm" | "mechanical"` 标记
- 触发器 ⇄ 会话的循环依赖经 `SessionPort` 消解：factory 先构造 SessionManager，port 是普通对象，capability 在 `init` 中拿到它；`assembleProject` 支持 `wrapSessionPort` 钩子在 capabilities init 前替换 port（server 侧 trigger 借此改走 chat hub，`SendMessageMeta.agentId` 是路由上下文、不入持久化）
- **control 事件落库**：审批/问答 gate 的 `control/requested` / `control/resolved` 经 runner 的 control sink 包装层 persist → emit（wire 附 seq）；abort 的 `rejectAll` 对每个 pending 补发 `resolved {aborted}`；`derivePendingControls(events)` 投影 pending（requested 未配对 resolved 且其后无 `turn/end`，repair 合成的 turn/end 自动排除崩溃悬空）

## ProjectRuntime（对外协调层）

- 聚合 `ProjectManager`、`SessionRuntime`、`DataStore` 与 capabilities 数组；`triggerManager` / `timerService` 是从 capability 派生的 getter
- `dispatchAgentConfigChanged` 把配置变更广播给全部 capability
- `deleteAgent` / `shutdown` 遍历 capability 生命周期钩子做级联清理

## 数据层

### store 树

- `ProjectStore`（聚合根）持有 `ProjectConfigStore`、`SkillStore` 和 `Map<agentId, AgentStore>`
- 每个 `AgentStore` 急切聚合 profile / triggers 子 store；`sessions`、agent-level `SkillStore` 与 `McpConfigStore` 为 lazy 初始化（首次访问才打开对应存储）
- store 在构造时确定自己的文件路径，运行时不做 agentId → 目录查找
- **store 只管存储**：不持有运行时状态（如活跃会话实例）
- **thin aggregator**：聚合根不逐个 wrap 子 store 的方法，只暴露 getter；`ProjectStore` 自身承担 agent CRUD、AGENTS.md index 与 CHANGELOG 读写

### ProjectManager 门面

写入门面统一 = `resolveProjectPath` + `serverAccessPolicy.assertWrite` + per-path `FileWriteMutex` + fs 写：

- `writeFile` / `writeBinaryFile`：编辑保存、主题、附件上传
- `createEntry`（mkdir | touch）：文件树新建
- `deletePath`：文件树与附件删除，缺文件为 no-op
- `copyFileWithin`：图片导出；双端校验——源端 `assertRead`、目标端 `assertWrite`

锁只保证不撕裂；语义冲突由前端 dirty 状态 + fs.watch 兜底。

### AgentProfile

- 从 `.spherse/agents/{agent-slug}/profile.md` 解析；`id`（UUID）、`createdAt`、`slug` 创建后不可变
- `context` 字段声明项目内相对路径，构建 system prompt 时注入 Pre-loaded Context
- `AgentStore.saveProfile()` 写盘后同步刷新内存缓存；直接调底层 store 的 `save()` 只写盘不刷新
- profile 未声明 `tools` 时默认不分配任何工具

## 生命周期

- **配置热重载**：profile 更新后 `ProjectStore` 发 `agent_updated` 事件，活跃会话在下一轮生效：
  - SessionManager 收到事件后对所有属于该 agent 的 `AgentRunner` 调用 `markReloadPending`
  - 下一轮 `sendMessage` / `retryLastTurn` 前执行 `applyReload`：重建 systemPrompt / tools / streamFn，并经 `turnHooks.onReload` 通知能力重置 memo 状态
  - reload 失败保留旧配置不中断对话；进行中的响应不受影响
- **删除 agent**：compound operation，由 `ProjectRuntime.deleteAgent` 协调——evict 活跃会话、mcp 连接缓存失效、各 capability `onAgentDeleted` 清理、PM 删除数据

## 日志

- core 只定义 `Logger` 类型与兜底 `createSilentLogger`；生产 logger 由 server 组合根创建并经 `assembleProject` 注入
- AgentRunner 在 turn 中记录 agent loop 生命周期事件，store 在 init / create / persist 等关键操作输出日志
