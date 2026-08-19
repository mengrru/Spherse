# Core 微内核 + Capability 重构实施计划

- 设计文档：`design.md`（同目录）
- 策略：渐进绞杀，每阶段独立可合并；每阶段收尾跑 `npm run verify` + 受影响面 E2E

## P0 kernel 地基（纯新增，不改旧码）

- [x] T1 `kernel/capability.ts`：`Capability` 接口（id / init / tools / contextBlocks / pathRules / onAgentDeleted / shutdown）
- [x] T2 `kernel/ports.ts`：`SessionPort`、`McpHost`、`ToolHost`（携带 agentId）、`SessionView`、`PathRule { match, category, llm: { read, write } }` + `StoreRegistry`/`createStoreRegistry`（global + forAgent 作用域）
- [x] T3 `kernel/event-pipeline.ts`：`EventMiddleware`、`createEventPipeline`、`pipeMiddleware` 组合子（顺序、短路、变换、结合律）
- [x] T4 `kernel/message-log.ts`：`MessageEntry { dbId, message }`、append / dropLast / replaceMessage / compactLog 纯变换
- [x] T5 `kernel/context-block.ts`：开放 `ContextBlock { kind, render() }` + `taggedBlock` + `serializeBlocks`
- [x] T6 上述全部单测（23 个：pipeline 组合律、MessageLog dbId 不变量、注册冲突检测、StoreRegistry 隔离）

## P1 独立修 bug（可单独先合）

- [x] T7 FileWriteMutex 全项目唯一（实为**三把**：SessionManager、ProjectManager、SkillStore/AgentStore）：装配点创建唯一实例，经 ProjectStore → SkillStore/AgentStore、ProjectManager、SessionManager 注入；`shared-write-mutex.test.ts` 断言全链路同一实例
- [x] T8 `ModelCatalog` 类抽取（`model-providers/catalog.ts`）：per-runtime 实例；`model-providers/index.ts` 模块级导出改为进程默认实例 facade 转发（签名不变，server/desktop 零改动）；实例隔离测试

## P2 绞杀会话层

- [x] T9 `session/agent-runner.ts`：从 LiveSession 拆出 turn 编排（sendMessage/retry/abort + buildAgent/buildPromptAndTools + ensureModel/ensureMcpTools/applyReload）
- [x] T10 middleware 化：`session/event-middlewares.ts`（logEventMiddleware / persistEventMiddleware / createAttachmentSanitizer），`createEventPipeline` 每次 prompt 现建；persist 基于 MessageLog（`liveMessageDbIds` 并行数组已消灭）
- [x] T11 Compactor 纯化：`session/compactor.ts` 的 `maybeCompactLog` 为 `MessageLog → MessageLog` 纯变换 + 一次落库；`extractToolArg` 去硬编码工具名（前两个 ≤120 字符的 string 参数 join " → "，兼容既有 digest 断言）
- [x] T12 `session/runtime.ts`：`RuntimeDeps`（Object.freeze）+ `RunConfigHolder`（只读快照，setDefaultModel/setSampling 改走 holder 单点更新）；`SessionContext` 删除；triggerManager 经 `getTriggerManager()` 稳定函数引用注入（P3 将替换为 SessionPort）
- [x] T13 LiveSession 变薄壳（76 行，保留类名与全部公开方法，内部委托 Runner），823 个 core 测试 + 全仓 verify 绿；server/desktop 零改动
- [x] T13b Runner 去能力化（评审修正）：`session/turn-hooks.ts`（beforeTurn/afterTurn/onReload + composeTurnHooks）；MCP 合并与 compaction 移入 `session/hooks/`（mcp-merge 带 memo + onReload 重置；compaction 为 log 纯变换）；`RuntimeDeps.createTurnHooks` 注入，Runner 334 行、零能力 import；设计文档 §1/§3 已补 TurnHooks 面
- [x] T13c ModelResolver 收敛（评审修正）：`session/model-resolver.ts`（resolveFor / resolveOrThrow，默认实现走进程 catalog facade，保持 desktop `syncCustomProviders` 全局生效语义）；消灭 ensureModel / applyDefaultModel / buildAgent 三处重复解析；Runner 只保留 turn 前置条件一行调用

## P3 能力化 + 装配点

- [x] T14 `capabilities/trigger/`：TriggerManager 依赖改为 kernel `SessionPort`（循环依赖消除，工厂以懒 port 适配器缝合）；gates（ApprovalGate/AskGate）上移 `kernel/gates.ts`，tools 侧 re-export；ToolHost 携带 per-session gates
- [x] T15 `capabilities/mcp/`：`mcpContextBlock`（kernel ContextBlock）+ turnHooks（合并 memo + onReload 重置）；session 依赖面删除 mcpConnectionManager；context/blocks 与 serialize 的 mcp 渲染退役；ProjectRuntime 经 capability invalidate/shutdown
- [x] T16 工具家族 capability 化：`capabilities/{fs,skill,changelog,render,agent-mgmt,interaction}`；agent-assembly 改为 registry 聚合（tools + contextBlocks，profile.tools 过滤）；append_changelog 窄化依赖；序列化统一为 kernel ContextBlock（serialize.ts 删除）
- [x] T17 `assembleProject` 落地（factory.ts 平移，createProject 兼容导出）：Capability 接口加 turnHooks 贡献；turn-hooks.ts 移入 kernel；SessionManager 构造注入 capabilities+stores 并聚合钩子；**setTriggerManager 与 RuntimeDeps.getTriggerManager 删除**；ProjectRuntime.deleteAgent/shutdown 遍历 capability 生命周期
- [x] T18 access 通用化：`PathRule`（match/category/llm 裁决）注册表；`categorizePath(rel, rules?)` 注册规则优先；`llmAccessPolicy(root, denied, rules?)` 规则自带裁决，中心允许集只管内置类别；ToolHost 携带聚合 pathRules；单测覆盖

## P4 验收：memory capability

- [x] T19 `capabilities/memory/store.ts`：per-agent JSONL `MemoryStore`（惰性缓存 + append 写入 + 纯函数 `filterEntries`），导出 `MEMORY_PATH_RULE`（布局知识归 store）
- [x] T20 `capabilities/memory/index.ts`：memoryCapability（memory_save / memory_recall 工具在 tools(host) 闭包捕获 host——无模块级状态；contextBlocks 注入当前 agent 最近记忆；stores.forAgent 作用域存储）；装配点注册 1 行；`toolCatalog`（holder 回填）使 manage_agent 运行时认识新工具名
- [x] T21 验证：12 个 memory/capability 测试；侵入面 diff 断言通过——现有文件改动中 memory 只出现于 factory.ts（import + 注册 1 处）；全仓 verify 绿；受影响面 E2E（chat×2 + agent-dialog/agent-list/app-launch）全过

## 依赖与顺序

T1-T6 → T7/T8（可与 P0 并行）→ T9-T13 → T14-T18（内部可并行，T17 依赖 T14-T16）→ T19-T21
