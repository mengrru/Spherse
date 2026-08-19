# feat/refactor-core 重构 Review

- 日期：2026-08-20
- 范围：分支 `feat/refactor-core`（243bb7b..6f3b3d4，含 core 微内核重构 P0-P5、P6 server 对齐、两轮清理），同时覆盖 `2026-08-20-p6-server-alignment` 的交付面
- 方式：4 路并行深审（kernel / capabilities / session / 装配根与 server）+ 依赖图静态分析 + 关键断言人工复核
- 评审目标：模块边界清楚、新增模块侵入性小、模块间可组合、松耦合

## 总评

方向正确，kernel/capability 骨架是真的：EventPipeline / MessageLog / TurnHooks / ContextBlock / PathRule 均有组合律测试；820 个 core 测试 + server 197 + desktop 110 全绿。memory capability 验收在 core 层面属实（新目录 + factory 一行）。

但重构**未彻底收尾**：1 个真实回归 bug（Critical）、约 6 处"绞杀到一半"的僵尸接缝、组合根本身不可参数化。按四个目标打分：

| 目标 | 达成度 |
|------|--------|
| 边界清楚 | ≈75%（kernel→store 类型依赖、capability→session 逆向边、tools 僵尸层） |
| 新增模块侵入性小 | ≈80%（core 层达成：1 行；产品层仍 ~7 文件/5 包 stringly 契约） |
| 空间可组合性 | ≈70%（组合根硬编码 capabilities，builtin.ts 是第二装配点） |
| 松耦合 | ≈75%（SessionPort 成立；ToolHost 宽服务包、ProjectRuntime 嗅探内部） |

## Critical（合并前必须修）

### C1. 附件上传被 P6 写入门面弄坏（真实回归，已验证）

- `server/routes/attachments.ts:81` 改走 `pm.writeBinaryFile()` → `project-manager.ts:236` 执行 `serverAccessPolicy().assertWrite`，但 `SRV_WRITE`（`access/access-policy.ts:55-62`）**不含 `"attachments"` 分类** → 上传 `.spherse/attachments/<file>` 必抛 `AccessDeniedError`（已用编译产物 live repro 确认）
- 原路由自己做 `isPathInside` 检查、不查 `SRV_WRITE`，上传是通的；P6 迁移后断掉
- `server/__tests__/attachments.test.ts:63-67` mock 掉了 `writeBinaryFile`，测试全绿——被 mock 掩盖的真回归；无附件 E2E
- **修复**：`SRV_WRITE` 加入 `"attachments"`；补一条走真 `ProjectManager` 的集成测试（或 core 层断言 `writeBinaryFile` 允许 attachments 目录）

## 不彻底（half-strangled seams）

### 1. 僵尸工具注册表（设计缺陷 #2 原样存活）

- `tools/index.ts:68` 仍是 `if (ctx.triggerManager)` 条件注册——设计文档点名的缺陷原文；`tools/tool-context.ts:14-23` 仍是 9 参聚合构造器
- 两者零生产调用方，唯一消费者是 `__tests__/tools/tools-integration.test.ts`；重构甚至花 diff 更新了这条死路径（551306a 为 `KnownToolsRef` 改签名）
- 更危险：`tool-context.ts:53-58` 构造的 `llmPolicy` **不带 pathRules**——谁复活这条路径，capability 路径规则静默失效
- **修复**：删除 `tools/index.ts`、`tools/tool-context.ts`、`BUILTIN_TOOL_NAMES` 及对应测试（或改写为针对 `buildPromptAndTools` 真实路径的断言）

### 2. store→presets 注入未兑现（设计缺陷 #7）

- 设计 §4 承诺 `ProjectStore.open({ seed })`；实际 `store/project.ts:8` 仍硬 import `@spherse/presets`（`PRESET_SKILL_SOURCES`、`AGENTS_INDEX_TEMPLATE`）
- 且 P6 把 `PRESET_AGENTS`/`AGENT_TEMPLATE` 挪进了新的 `core/presets.ts`——core 内部从 1 处 presets import 变成 **2 处**，接缝更散而非收敛
- **修复**：`SkillStore`/`ProjectStore.open` 接受 seed 参数；`@spherse/presets` 唯一 import 收敛在 `presets.ts`，由 factory 调用传入

### 3. setEventSink 只消灭一半 + 并发 trigger 破坏 in-flight turn

- agent 事件流已是 per-prompt `createEventPipeline`（`agent-runner.ts:149-157`），但 control-bus 的 `setEventSink(onEvent)/setEventSink(null)` 配对仍在（`agent-runner.ts:159/172/208/216`）
- 具体危险：`TriggerManager` 经 `SessionPort.sendMessage` → `SessionManager.sendMessage`（`trigger-manager.ts:281`）**绕过 server 的 `channel.running` 串行守卫**（chat-session-hub.ts:126 只串行化 UI 发起的运行）。trigger 在 turn 进行中触发时：第二次 `sendMessage` clobber 第一次 turn 的 control sink（:159）→ `agent.prompt` 抛 already processing → `finally` 置空 sink——第一次 turn 的审批请求再也到不了任何客户端，挂死到 5 分钟超时（approval-gate.ts:4）
- **修复**：control 事件走同一 per-prompt pipeline（sink 按 run 捕获）；Runner 层加 in-flight guard（并发 `sendMessage`/`retryLastTurn` 抛 `ValidationError`），不让 core 依赖 server 串行化

### 4. `Capability.init`/`KernelServices` 是死扩展点；SessionPort 靠 ref 缝合

- `kernel/capability.ts:10` 的 `init?(ctx: KernelServices)` **全仓无任何调用方**；`KernelServices` 唯一消费者就是这个死方法
- trigger 的 SessionPort 实际靠 `factory.ts:70-83` 的 `sessionRuntimeRef.current!` 手工缝合：trigger capability（及其已启动的 TimerService，`capabilities/trigger/index.ts:35-36`）在 L79 创建，`new SessionManager` 在 L106——装配窗口期（L83-L107 之间抛错或 timer 触发）非空断言直接 TypeError。旧 `setTriggerManager` setter 时序耦合换成了 ref+断言，同一类缺陷换了形态
- 附带：`onEvent as never`（`factory.ts:76`）暴露 `SessionPort.sendMessage` 类型欠账，消费侧 `(event as {type?:string})` 强转回来
- **修复**：真正接线 `init(ctx)`——先构造 SessionManager，再对每个 capability `await init(services)`（sessionPort 变普通对象，消灭 ref）；trigger 的 `getSessionPort`、mcp 的 `loadServers` 闭包（`factory.ts:58-67`）都应移入 `init`。或彻底删掉 `init`/`KernelServices`（连带消除下条 kernel→store 依赖）

### 5. 生命周期钩子不完整：memory 泄漏 + `stores.clearAgent` 生产死代码

- 设计 §5 明确 memory 需 `onAgentDeleted: (id) => closeMemoryStore(id)`；实际 `capabilities/memory/index.ts` **没有实现** `onAgentDeleted`
- `kernel/ports.ts:103` 的 `clearAgent` 只有 kernel 测试调用；`project-runtime.ts:58-65` 的 `deleteAgent` 从不调用——删 agent 后其 `MemoryStore`（含缓存，`memory/store.ts:44`）永久留在 `agentScopes` 直到项目关闭
- **修复**：memory capability 实现 `onAgentDeleted`（自然经 `init(ctx)` 拿到 `ctx.stores`）；或 runtime 统一在 capability 循环旁调一次 `stores.clearAgent(agentId)`

### 6. `getFileWriteMutex` 未按 P6 承诺退役；双锁 precondition 仍在

- P6 设计说"标记 `@deprecated`，route 迁移后删除"；routes 已全部迁移（零生产调用），但 `project-manager.ts:217-219` 访问器**未标记**未删除
- PM / ProjectStore 构造器仍留 `fileWriteMutex ?? new FileWriteMutex()` 默认——原双锁 bug 的 precondition 还在一个漏参数之遥；`shared-write-mutex.test.ts:67-74` 甚至断言两个手工 PM 各持独立锁
- **修复**：删除访问器，测试改断言共享实例；构造器要求显式注入（或注入进程级共享默认）

### 7. kernel→store 类型依赖（最稳定层绑到持久层）

- `kernel/ports.ts:3` `import type { ProjectStore } from "../store/project.js"`——ProjectStore 是 250 行 EventEmitter god-object，自己还 import presets/gray-matter/nanoid/fs。kernel 的编译面传递性绑定整个 store 图，稳定性梯度倒置
- 这是 type-only 泄漏（运行时纯净成立），但 `KernelServices` 的唯一用途（#4 的死 `init`）正是它存在的唯一理由
- **修复**：删 `init`/`KernelServices` 即连带消除；或在 kernel 定义窄 port（实际用到：`getAgent(id)`、`getRootPath()+config.deniedPaths`、`readIndex()`、`sessions`——4 方法 `ProjectDataPort`），store 结构化 conforms

### 8. Runner 并非零能力感知：附件编排 + compaction restore 内联

- `agent-runner.ts:2/22/24`：Runner 亲自构建附件 sanitizer、定位它在链中的位置（:147-153）、在 `finally` 里做 strip/restore（:166-170）——设计点名的"sendMessage 内联编织附件脱敏"在 finally 块里复活
- restore 路径硬编码 compaction DB 知识（`getLatestCompaction`/`getMessagesAfter`，:94-104）
- **修复**：给 turn 一个 kernel 级扩展点（如 capability 贡献 `prepareTurn()` 返回 `{ middlewares, finalize() }`），Runner 只组合不感知；至少把 finally 块收进 sanitizer 对象（`sanitizer.finalize()`）

### 9. 可变标记未消灭只是搬家；MCP 配置变更对 live session 无效

- `pendingReload` 原名保留在 Runner（`agent-runner.ts:34, 121-133`）
- MCP 的 `beforeTurn` 是 `let merged = false` memo（`capabilities/mcp/index.ts:42-46`），只被 `onReload` 重置；`ProjectRuntime.updateAgentMcp` 调 `invalidate(agentId)`（`project-runtime.ts:72`）清 manager 缓存但**不清 hook memo**；`ProjectManager.updateAgentMcp` 不发 `agent_updated`（`project-manager.ts:97-104`）→ **编辑 agent 的 MCP servers 对任何 live session 无效**，直到一次无关的 profile 编辑触发 reload
- **修复**：memo 按配置版本 key（`invalidate` 时 bump `version(agentId)`）；或 `updateAgentMcp` 标记受影响 live session 为 reload-pending

### 10. restore 路径绕过 `sanitizeToolCallPairs`：live log ≠ restored log

- live compaction 会清 error/aborted assistant 与孤儿 toolResult（`compactor.ts:52`、`context/compaction.ts:188-219`），但 `initForRestore` 从原始 DB 行重建（`logFromCompaction`，`compactor.ts:96-111`，无 sanitize 调用）
- restore 后，toolCall 已被压进 digest 的孤儿 `toolResult` 重新进入 `agent.state.messages`——多数 provider 直接拒绝。属预存在问题，但设计的"compaction 是 MessageLog→MessageLog 纯变换、dbId 不变量"框架宣称这类 desync 已死，实际没有
- **修复**：`logFromCompaction` 内对 tail 行跑同一 `sanitizeToolCallPairs`（已是纯函数，keptIndices 直接映射 dbIds）

### 11. 唯一 capability→session 逆向边：compaction

- `capabilities/compaction/index.ts:3` import `../../session/compactor.js`——全部 capability 中唯一一条；设计 §2 映射表说"compaction 进 kernel"
- `session/compactor.ts` 混了两件事：capability 的 afterTurn 纯变换（:28-90）与 session restore 工具（`logFromRows`/`logFromCompaction`，agent-runner 消费）
- **修复**：`maybeCompactLog`（含 `planCompaction`/`sanitizeToolCallPairs` 胶水）移入 `capabilities/compaction/transform.ts`；restore 构造器留在 session（持久化格式兼容，归 session 合理）

## 不合理（judgment issues）

### J1. 组合根不可参数化；builtin.ts 是第二装配点

- 设计 §2 承诺 `assembleProject(root, capabilities[])`；实际签名（`factory.ts:22-28`）**无 capabilities 参数**，列表硬编码在 `factory.ts:94-101`，纯工具类 capability 又走 `capabilities/builtin.ts:8-16` 另一份列表
- server（`registry.ts:78`）/ desktop 无法增删换 capability 而不改 core——"任意子集组合"只能靠改 core 源码或测试手工拼 `RuntimeDeps`（live-session.test.ts:98-110，还带着已删除的 `getTriggerManager` 字段）
- **修复**：`AssembleOptions.capabilities?: Capability[] | (builtin: Capability[]) => Capability[]`；builtin.ts 收敛为该参数默认值

### J2. ProjectRuntime 嗅探 capability 内部

- `project-runtime.ts:32-34` 以 `c.id === "mcp" && "invalidate" in c` 鸭子类型找 MCP；`:37-51` 结构强转取 `triggerManager`/`timerService`；`:67-74` 硬编码 `mcpCapability?.invalidate()`
- 根因：`onAgentDeleted` 是 sync-only，MCP 的 async 清理只能在循环外特判——生命周期钩子覆盖不了 async，正是嗅探存在的原因。每个未来 runtime-facing capability 都会让此文件再长，重新制造旧缺陷 #3
- **修复**：`onAgentDeleted` 改 `Promise<void>` 并去掉特判；`manager`/`timerService` 经可选声明接口暴露而非强转；或通用 `onConfigChanged(agentId, kind)` 钩子替代硬编码 invalidate

### J3. ToolHost/SessionView 是宽服务定位包，不是窄 port

- `ports.ts:50-62` 给每个工具/上下文提供者全量字段（projectStore、fileWriteMutex、logger、stores、pathRules、toolCatalog、两个 gate、sessionId）；`ports.ts:64` `SessionView = ToolHost` 全量别名——设计意图中 SessionView 是窄视图，实际 contextBlocks() 拿到了 gates/mutex/sessionId 等不该看的字段
- 后果：设计 §7"capability 用 port mock 独立测试"做不到——memory.test.ts:73-81 得构造真 ProjectStore 并 `as never` 伪造 mutex
- **修复**：按关注点拆 port（`AgentScope {agentId, stores}`、policy 来源、write 协调器）；至少 SessionView 给自己的 3 字段窄接口

### J4. 领域概念进内核 + 契约成员放错文件

- `kernel/attachments.ts:4-21` 的 `AttachmentProcessor`/`PreparedContentBlock` 是 LLM 消息领域概念，为避免 `capabilities/attachments → src/attachments` 依赖而硬抬进 kernel——但该规则在别处早已破例（interaction→tools、compaction→session、trigger→store），纯净只是纸面
- `TurnMiddlewareSource`（attachments.ts:23-25）与附件无关，却是 Capability 契约成员（capability.ts:8 引它），导致 `capability.ts:5` 为无关类型 import attachments.js；且该扩展点**无任何生产 capability 贡献 middleware**（只有测试用）
- **修复**：`TurnMiddlewareSource` 移入 capability.ts（或 turn-middleware.ts）；`AttachmentProcessor` 移回附件域模块

### J5. toolCatalog 事后回填时序耦合 + 冲突策略不一致

- `agent-assembly.ts:105` 建 `toolCatalog = { names: [] }` 传入 host，L121-124 调各 capability `tools(host)`，L125 才**变异数组**填充 names。注册期间读 `host.toolCatalog.names` 只得 `[]`；`readonly` 字段是谎言，正确性依赖未声明的"执行时才读"约定（manage-agent.ts:116 恰好如此）
- `CapabilityRegistry.register` 对 id 冲突 throw（capability.ts:24-26），但跨 capability 工具名冲突静默 last-wins（`toolMap.set`，agent-assembly.ts:123）——新 capability 遮蔽 `read_file` 零信号
- **修复**：两阶段构造（build tools → freeze catalog → build host）或 lazy getter；工具名冲突 warn/throw

### J6. `composeTurnHooks` 零测试

- afterTurn 的 log 穿线语义（turn-hooks.ts:17-22）+ mcp-beforeTurn/compaction-afterTurn 交互是内核最微妙的组合语义，无任何测试
- **修复**：补组合律测试（顺序、log 传递、onReload 传播）

## Minor（择机处理）

- **M1** `context/` 是 session 私有帮助库：4 个文件只被 session 消费；compaction 纯函数没进 kernel（设计映射表说进）。token-estimate/planCompaction/sanitizeToolCallPairs 应进 kernel，compactor.ts 吸收进 capability，preloaded-context/time-perception 挪到唯一消费者（agent-assembly）旁
- **M2** gate 类型从 tools re-export 壳 import（agent-assembly.ts:6-7、approval-gate.ts:1、ask-gate.ts:1），规范源是 kernel/gates.ts；ports.ts:60-61 用内联 `import("./gates.js")` 而非顶层 import
- **M3** `engine/` 单文件遗留目录（log-agent-event.ts，仅 event-middlewares.ts:2 消费），折进 session/ 或 logger
- **M4** `agent-assembly.ts:146-151` 重复内联 `llmAccessPolicy(root, deniedPaths, pathRules)`——`capabilities/shared/llm-policy.ts` 的 `llmPolicyOf(host)` 已封装且 host 就在手边；`agentSkillStore` 参数两处未使用（:96-103/169-175）
- **M5** `retryLastTurn` 跳过 `pendingReload` 检查（agent-runner.ts:176-218）：profile 更新后 retry 用旧 prompt/tools；也跳过 beforeTurn（借 memo 可辩护但属隐式）
- **M6** `TurnContextSnapshot` 不是快照：返回活 `messages`/`tools` 引用（agent-runner.ts:229-241），消费方持有即别名风险
- **M7** 测试伸进私有：live-session.test.ts:49-76 `(live as any).runner`；手拼 deps 含已删除字段 `mcpConnectionManager`/`getTriggerManager`（:103-105）；测试名 :224/:423 仍叫 "liveMessageDbIds"
- **M8** `registry.ts:39` `(this.modelCatalog ?? new ModelCatalog()).getSupportedProviders()`——未接线时每次调用新造 catalog，独立 server 永远看不到自定义 provider；应构造必填或缓存 fallback
- **M9** 写入门面覆盖不全：content.ts POST mkdir/touch 手搓 policy + 无锁 `fs.writeFile("")`（:114-119）、DELETE 无锁 `fs.rm`（:160-166）、images.ts:39-40 无锁 `fs.copyFile`、attachments.ts:117 无锁 `fs.unlink`——P6 承诺的三处已迁，但"锁靠调用方自觉"的退役目标只完成一半。扩门面（createFile/deletePath/copyFile）或明确记录边界
- **M10** `factory.ts:125` `export type { TriggerCapability }` 无消费者；`index.ts:1` `export * from "./types.js"` 通配符导出违反 AGENTS.md 导出清单原则
- **M11** `store/mcp-config.ts:3-4` 仍 import `../mcp/index.js`——缺陷清单 D3 的 store→mcp 半死；`normalizeMcpConfig` 是纯函数，可挪 store 或 kernel
- **M12** pathRules 只作用于 LLM 端：`serverAccessPolicy` 忽略 extraRules（access-policy.ts:141-143），capability 私有文件对 server 永不可写（memory 场景合理，但语义未文档化）；AI deniedPaths 先于 rules 检查（:74-83）——用户 deny `.spherse` 会静默杀死 memory 持久化，优先级合理但无处声明
- **M13** turn-hooks.ts:2 kernel 内部绕路 `from "../kernel/message-log.js"`，应为 `./message-log.js`
- **M14** memory 处于休眠：`memory_save`/`memory_recall` 不在任何 UI 注册表（app/tool-registry.ts）、默认模板、i18n 中——验收证明的是 seam，不是用户能打开的能力；且 §7 承诺的常驻"侵入面 E2E 脚本"不存在（T21 是一次性检查，P0-P5+memory 挤在单个 75 文件 commit 里，"diff 只碰 factory.ts"无法从 git 历史复核）

## 设计缺陷清单对账（design.md L13-36）

| # | 缺陷 | 状态 | 证据 |
|---|------|------|------|
| B1 | SessionContext 共享可变 | **已修** | 冻结 RuntimeDeps + RunConfigHolder；setDefaultModel 走 holder 单点 |
| B2 | ToolContext 9 参 + 条件注册 | **部分** | 活路径已换 ToolHost；僵尸 tools/index.ts:68 + tool-context.ts 原样存活（测试专用） |
| B3 | 新增模块改 7 处中心文件 | **大体已修** | memory = 新目录 + factory 一行；例外：runtime 暴露（J2）、async 清理（I3） |
| B4 | ContextBlock 封闭 union | **已修** | kernel 开放接口 + serializeBlocks，memory 自定义 kind 验证 |
| B5 | deleteAgent 手工编排 4 模块 | **部分** | 遍历 capability，但 MCP 特判嗅探、clearAgent 未接线、memory 缺 onAgentDeleted |
| B6 | 双 FileWriteMutex | **装配点已修** | factory.ts:36 单实例全链注入；构造器 `?? new` 默认仍在（#6） |
| B7 | store→presets 硬编码 | **未修** | store/project.ts:8 原样；且 core 内 presets import 变两处（#2） |
| B8 | digest 硬编码工具名 | **已修** | extractToolArg 通用化；summarizeArgs 扩展点未加（可接受） |
| D1 | session 上帝模块 | **大体已修** | session 不 import capabilities；Runner 仍直连 attachments/compactor（#8） |
| D2 | trigger⇄session setter 缝合 | **已修** | SessionPort 注入；setTriggerManager 全仓删除；但 ref+`!` 缝合换形态（#4） |
| D3 | context→mcp、store→mcp | **部分** | context→mcp 已修（block 进 capability）；store→mcp 残留（M11） |
| S1 | model-providers 全局可变单例 | **已修** | ModelCatalog 类 + 组合根所有权 + 可变 facade 退役（P6 交付） |
| S2 | liveMessageDbIds 并行数组 | **已修** | MessageLog 单源；仅测试名残留（M7） |
| S3 | setEventSink 开关 + 内联横切 | **部分** | agent 流已管线化；control-bus 开关仍在且有并发破坏路径（#3） |

## P6 三项交付判定

- **#1 ProjectCtx 收敛**：干净交付（registry 冻结转发 getter，真相源唯一）
- **#3 catalog 所有权上移**：交付（desktop appModelCatalog → server registry → RuntimeDeps 全链；可变模块导出真退役；仅 registry.ts:39 懒造 catalog 一处瑕疵 M8）
- **#2 写入门面**：**纸面交付、实际破坏**——门面本身正确（resolve+assert+mutex+write），但迁移 attachments 未同步 `SRV_WRITE` 产生 C1 用户可见回归；mkdir/touch/delete/copy 仍绕门面（M9）；`getFileWriteMutex` 退役跳过（#6）

## 建议修复顺序

1. **P0（合并阻塞）**：C1 回归（一行 + 真 PM 集成测试）
2. **P1（删/接线，低风险）**：
   - 删僵尸三件套：tools/index.ts、tool-context.ts、对应测试、`getFileWriteMutex` 访问器
   - `init`/`KernelServices`：接线或删除（连带消 kernel→store 类型依赖）
   - memory 补 `onAgentDeleted` + `stores.clearAgent` 接线
   - `assembleProject` 开放 `capabilities` 参数，收敛 builtin.ts
   - `composeTurnHooks` 补组合律测试
3. **P2（结构性，可单独分支）**：
   - control-bus 管线化 + Runner in-flight guard（#3）
   - 附件编排/restore 知识出 Runner（#8、#10）
   - compaction 变换挪入 capability（#11）
   - MCP memo 版本化 + updateAgentMcp 发 agent_updated（#9）
   - ToolHost 拆窄 port、ProjectRuntime 去嗅探（J2/J3）
4. **P3（择机）**：Minor 清单 + memory 产品化（UI/i18n/presets 注册表）

## 附：新增 capability 的真实侵入面（现状）

- **core 层面（memory 标准的验收）**：新目录 + `factory.ts` capabilities 数组一行。属实——前提是不需要 SessionPort 接线（需要则还得加懒 ref 适配器）、不要求 runtime/server 暴露（要求则 project-runtime.ts 特判 + routes/ws-bus）、不需要配置失效钩子。pathRules 对 LLM 裁决端到端自足，无需动 tools/index.ts、path-category、允许集
- **用户可见工具层面**：另需 app/tool-registry.ts（UI 开关组）、i18n 三语言 `tool.foo`/`tool.foo_hint`、presets agent-template.md（默认工具表）——约 5-7 文件/4-5 包，工具名概念仍是跨 core/app/i18n/presets 的分布式 stringly 契约，无单一 owner。诚实表述：**core 内部侵入性从 7 处中心文件降到 1 行；产品级侵入性未变**
