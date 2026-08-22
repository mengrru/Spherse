# @spherse/core

纯 Node.js 核心逻辑，采用**微内核 + Capability** 架构。本文是 core 的开发守则——新代码必须遵守，review 时以此为准。架构细节的完整描述见 `docs/official/architecture.md`，目录索引见 `docs/official/project-structure.md`。

## 架构总览

```
                    ┌────────────────────────────────┐
                    │   factory.ts  assembleProject  │
                    │   唯一装配点（知道一切的地方）    │
                    └───────┬────────────────┬───────┘
                            │                │
             ┌──────────────▼───┐   ┌────────▼─────────┐
             │  session/        │   │  ProjectManager  │
             │  会话运行时引擎    │   │  数据访问/写入门面 │
             │  AgentRunner     │   └──────────────────┘
             │  （turn 编排）    │
             └──────┬───────────┘
                    │ 只依赖类型
        ┌───────────▼───────────┐
        │  kernel/  零 I/O      │◄────────── capabilities/*
        │  类型 + 纯组合子        │   能力模块（只依赖 kernel）
        └───────────┬───────────┘
                    │ 单向依赖
        ┌───────────▼───────────────────────────────┐
        │ store / access / context / attachments /   │
        │ mcp / tools / trigger / model-providers /   │
        │ utils  （支撑层：磁盘真相、纯函数、实现体）    │
        └────────────────────────────────────────────┘
```

- **kernel/**：只有类型（`Capability`、`ToolHost`、`SessionPort`、`PathRule`…）和纯组合子（EventPipeline、TurnHooks、ContextBlock）。零 I/O、零实现。
- **session/**：会话运行时。`AgentRunner` 在固定时机调用 kernel 抽象，对具体能力零 import；`agent-assembly` 从 profile 组装 Agent；`SessionEventLog` 持有 append-only 事件并同步写 SQLite；`SessionManager` 管理 session 池，并在可写 restore 前自动迁移 legacy 会话。
- **capabilities/**：能力模块。每个目录自足，只依赖 kernel 类型，经 `Capability` 接口贡献工具 / context block / turn hooks / attachment processor / path rule / 事件 middleware / 生命周期钩子。
- **装配点**：`assembleProject` 组合一切。capabilities 列表可参数化（`AssembleOptions.capabilities` 接受数组或 `builtin => list` 函数）。

依赖方向严格单向：`capabilities → kernel ← session`，装配点在顶层缝合。禁止反向。

## 设计哲学

1. **贡献即数据（Capability）**——能力是一个对象，不是一个待修改的调用链。新增行为 = 新增贡献，而不是修改既有代码。
2. **依赖即窄接口（Port）**——模块只看见它需要的最小面。trigger 只见 `SessionPort` 五个方法，不知道 SessionManager 存在；capability 的 contextBlocks 只见 `SessionView` 三字段。
3. **横切即管线（Middleware）**——事件流上的横切关注点（日志、持久化、脱敏）是可组合的 middleware，不是内联回调。链序固定：`log → capability middlewares → sanitizer? → persist`。
4. **状态即单源（SessionEventLog / 冻结 deps）**——会话 durable state 以 append-only events 为唯一写入真相，`agent.state.messages` 由 fold 重建；`RuntimeDeps` 构造后冻结，可变配置只经 `RunConfigHolder` 单点更新。禁止另建并行消息真相源、禁止共享可变上下文。
5. **磁盘格式是契约**——`sessions.db` 的 sessions/events schema、事件 `data` 与 `schema_version`、`.spherse/` 目录布局不可轻动。旧 messages/compactions 仅供迁移前读取，首次可写 restore 由 `SessionManager` 在 core 内部单事务幂等迁移；兼容逻辑归 session 层，不暴露客户端迁移 API。
6. **安全不变量不可拔插**——base64 卫生（attachment sanitizer）、路径穿越校验、写互斥是系统不变量，不是可选项。它们住在固定的层（附件域/session 层/PM 门面），由 Runner 或门面无条件装配，**永远不要做成 capability**。

## 增加能力的原则

以 memory 为验收案例：新增能力 = **新目录 + 装配点一行**，其余零改动。做新能力时：

1. **先问归属**：它是「能力」（可选、可组合、贡献工具/知识）还是「不变量」（安全、持久化语义）？后者不要做成 capability（见哲学第 6 条）。
2. **新目录 `capabilities/<name>/`**，工厂函数返回 `Capability`。一切经接口贡献：
   - `tools(host)`：工具在 `(host)` 时**闭包捕获 host**，禁止模块级可变状态存 host；
   - `contextBlocks(view)`：注入 system prompt 的知识块（`ContextBlock { kind, render() }`，kind 自由字符串）；
   - `turnHooks`：turn 生命周期行为（`beforeTurn(agent)` / `afterTurn(agent, TurnEventAppender)` / `onReload`）——afterTurn 只能通过窄 appender 读取/追加 session events；注意 Runner 对你零感知，只能通过这些时机点行为；
   - `streamDecorators`：改写 LLM 请求流的装饰器（`StreamDecorator = (view) => (base: StreamFn) => StreamFn | undefined`，洋葱组合——后注册者最外层；time-perception 为首个实例）；
   - `contextProjectors`：上下文投影器（`ContextProjector = (view) => (messages) => messages | undefined`，管线序组合——在 convertToLlm 前清洗 AgentMessage，如 attachments 剥 `_attachments`/空 image block；持久化历史的 fold 语义不放这里）；
   - `attachmentProcessors` / `pathRules` / `eventMiddlewares` / `init(services)` / `onAgentDeleted` / `onAgentConfigChanged(agentId, kind)`（统一配置变更信号，kind: `"mcp" | "tools" | "profile"`）/ `shutdown`：按需实现。
3. **需要会话驱动的，声明依赖 `SessionPort`**（create/restore/sendMessage/abortSession/sessionExists——完成通知 = await sendMessage 的 Promise），由 `init(services)` 接线——不要 import SessionManager，不要接受懒 ref。
4. **需要私有存储**：布局知识（路径、格式）写在能力自己的 store 模块并导出 `PathRule`（自带 `llm: { read, write }` 裁决），capability 只引用注册。per-agent 存储用 `stores.forAgent(agentId)` 作用域，`onAgentDeleted` 里清理。
5. **注册**：装配点 `defaultCapabilities`（或经 `assembleProject` 参数注入）加一行。**侵入面以 git diff 为验收**——如果新能力需要改 tools/session/access 的既有文件，先停下来检查是不是接口缺了贡献点（缺则在 kernel 补接口，而不是在消费方开洞）。
6. **测试随能力走**：capability 目录下逻辑 + `__tests__/capabilities/` 对应测试；组合语义（hooks 链、middleware 序）测 kernel 组合子本身。
7. **产品化提醒**：core 层接入完成后，用户可见的工具还需 app tool-registry、i18n 三语、presets 默认模板——那是独立 feature，不要塞进能力目录。

## 关键约定

- **写入一律走门面**：任何组件写项目文件必须经 `ProjectManager`（`writeFile` / `writeBinaryFile` / `createEntry` / `deletePath` / `copyFileWithin`，内部 = resolveProjectPath + accessPolicy + per-path FileWriteMutex）。禁止 route / capability 直接 `fs.writeFile` 项目内路径。
- **FileWriteMutex 全链路一把**：由装配点创建唯一实例注入。任何构造器都不得默认 `new FileWriteMutex()`。
- **model catalog 实例归组合根**：`ModelCatalog` 由 desktop main / server registry 持有注入。core 不得新增模块级可变导出。
- **Runner 并发语义**：同一 session 并发 `sendMessage`/`retryLastTurn` 抛 `ValidationError`（in-flight guard）；control sink 经 `swapEventSink` 栈恢复。新调用路径必须经 Runner，不得绕过。
- **会话持久化语义**：业务代码只通过 `SessionEventLog.append/appendBatch` 追加事实，不直接改写 events；`seq` 是单个物理 session log 内从 0 连续的本地序号。fold、repair、retry 和 compaction 的控制事件语义统一维护在 `session/`，不得在 server/app 重复实现。
- **access 裁决优先级**：deniedPaths > capability pathRules > 内置类别白名单；pathRules 仅作用于 LLM 端。
- **导出面**：`index.ts` 显式清单，只导出外部实际消费的符号；新增导出先查消费面。
- **类型源**：gates 自 `kernel/gates.ts`、AttachmentProcessor 自 `attachments/index.ts`——不要从 tools 的 re-export 壳 import。
- **测试不伸私有**：测 AgentRunner 直接构造它（`AgentRunner.init(deps, …)`），不要从 SessionManager 里挖 `(x as any).sessions`。

## 验证

```bash
npm test --workspace=packages/core    # 单测
npm run verify                        # lint + build + 全部单测 + i18n
```

修改会话/能力相关代码后，按影响面选跑 E2E（见根 AGENTS.md）。
