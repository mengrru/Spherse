# Core 微内核 + Capability 重构设计

- 日期：2026-08-19
- 分支：`feat/refactor-core`
- 状态：设计定稿，待实施

## 背景与动机

从函数式视角审查 `packages/core` 后确认：代码中已有良好的函数式碎片（compaction/serialize/token-estimate 纯函数、with-approval 装饰器、McpConnectionManager 的 port 注入、access-policy 闭包工厂），但它们被埋在命令式装配胶水中——Context 大杂袋、上帝类、setter 缝合的循环依赖。

目标是让各模块真正独立，通过组合构成整体（空间可组合性），使新增模块（如 memory）对其它模块的侵入面最小。

### 现状缺陷清单

**边界缺陷**

1. `SessionContext`（session/types.ts:8）混合稳定依赖与可变配置，被所有 LiveSession 共享引用，`setDefaultModel` 原地修改。
2. `ToolContext` 9 参构造器聚合一切；工具注册表硬编码 `if (ctx.triggerManager)` 条件注册（tools/index.ts:68）。
3. 新增能力模块需修改至少 7 处中心文件：factory.ts、project-runtime.ts、session/types.ts、tool-context.ts、tools/index.ts、context/blocks.ts（union）、access/path-category.ts。
4. `ContextBlock` 是封闭 union，新增 block 类型必须改 union + serialize switch。
5. `ProjectRuntime.deleteAgent` 手工编排 4 个模块清理顺序，生命周期知识分散。
6. **双 FileWriteMutex bug**：ProjectManager（project-manager.ts:16）与 SessionManager（session-manager.ts:37）各 new 一把，同一项目两把写锁，并发保护失效。
7. store/project.ts 直接 import `@spherse/presets`，持久层绑死预置内容。
8. 压缩策略硬编码工具名（compaction.ts:44-59）。

**依赖缺陷**

- session 是上帝模块，依赖其余全部 9 个目录。
- `trigger ⇄ session` 循环依赖，靠 factory.ts:47 `setTriggerManager()` 运行时缝合（时序耦合）。
- context → mcp、store → mcp：底层反向知道特性模块。

**状态缺陷**

- model-providers 模块级全局可变单例（`const models` / `let registeredDefs` / `customIds`，index.ts:78-84），进程级共享，多项目互染。
- `liveMessageDbIds` 与 `agent.state.messages` 两条并行数组按下标手工对齐（live-session.ts:87,160,401-428），compaction 后人肉重排——最危险的不变量。
- 事件流命令式开关：`setEventSink(onEvent)/setEventSink(null)` 时序配对；sendMessage 的 subscribe 回调内联编织日志/附件脱敏/持久化/转发四件横切事，不可组合。

## 约束

- **渐进式绞杀**：每阶段独立可合并、可发布，旧路径逐步迁移。
- **server 入口不动**：ProjectRuntime/SessionManager 等对外 API 签名保持可用（deprecated 转发），registry/routes/contracts 不改。
- **验收案例**：实现最小 memory capability（per-agent），证明新增模块侵入面收敛到注册点。

## 方案选型

- **A. 微内核 + Capability 注册表（选定）**：能力贡献变成数据，装配点唯一。
- B. Effect 单子化：与 pi-agent-core 命令式内核适配成本过高，放弃。
- C. 纯六边形 ports 倒置：侵入面缩小但未收敛到一处注册，可组合性达成度低；其 ports 手段作为 A 的 kernel 内部实现细节吸收。

## 设计

### §1 内核抽象（kernel/）

kernel 只含类型与纯组合子，零 I/O。

**Capability——能力即数据，注册即组合**

```ts
export interface Capability {
  id: string;
  init?(ctx: KernelServices): Promise<void>;
  tools?(host: ToolHost): AgentTool[];                    // host 携带 agentId
  contextBlocks?(s: SessionView): Promise<ContextBlock[]>; // s 携带 agentId
  pathRules?: PathRule[];
  onAgentDeleted?(agentId: string): void;
  shutdown?(): Promise<void>;
}
```

**窄 port——每个能力只看见它需要的**

```ts
export interface SessionPort {
  createSession(agentId: string, source?: string): Promise<string>;
  restoreSession(agentId: string, sessionId: string): Promise<string>;
  sendMessage(sessionId: string, msg: string, onEvent: (e: unknown) => void): Promise<void>;
  sessionExists(agentId: string, sessionId: string): boolean;
}
```

**PathRule——访问裁决自带完整判定**

```ts
export interface PathRule {
  match: RegExp;                    // project-relative 路径匹配
  category: string;                 // 分类名（自由字符串）
  llm: { read: boolean; write: boolean };  // 该分类对 LLM 的读写裁决
}
```

职责划分：**store 拥有布局知识，capability 拥有注册，access 保持通用**。`categorizePath()` 是每次工具调用前同步执行的纯函数，必须在 store 惰性实例化之前就能裁决路径归属，因此规则是声明式数据；但布局常量（如 `agents/<dir>/memory.jsonl` 的正则与路径）由 store 模块自己导出（如 `MEMORY_PATH_RULE`），capability 只引用注册。规则自带 `llm.read/write`，新增分类无需修改 access 层中心的 `LLM_READ/LLM_WRITE` 允许集——侵入面真正收敛（否则仅声明 category 仍要改中心枚举）。

trigger → SessionPort、mcp → McpHost。循环依赖就此消解：能力依赖 kernel 类型，装配点注入实现。

**ContextBlock 开放接口**（替代封闭 union）

```ts
export interface ContextBlock {
  kind: string;      // 自由字符串，注册顺序即渲染顺序
  render(): string;
}
```

**事件管线**

```ts
export type EventMiddleware = (e: AgentEvent, next: (e: AgentEvent) => void) => void;
// 持久化、附件脱敏、日志各自独立 middleware，pipe(logMW, persistMW(log), attachMW) 组合
```

**TurnHooks——turn 生命周期钩子（Runner 对能力无感知）**

```ts
export interface TurnHooks {
  beforeTurn?(agent: Agent): Promise<void>;               // 例：MCP 工具合并（自带 memo）
  afterTurn?(agent: Agent, log: MessageLog): Promise<MessageLog>;  // 例：compaction（log 纯变换）
  onReload?(): void;                                       // 例：重置 memo 状态
}
```

Runner 只在固定时机调用钩子（beforeTurn → prompt → afterTurn；reload 时 onReload），不 import 任何具体能力。compaction 与 MCP 合并是钩子的两个实例（`session/hooks/`），P3 中由对应 capability 贡献。`RuntimeDeps.createTurnHooks` 是注入点，缺省组合为 `[mcpMerge, compaction]`。

**MessageLog**（消灭并行数组不变量）

```ts
export interface MessageEntry { dbId: number | null; message: AgentMessage }
// messages 与 dbIds 合并为单一有序结构，compaction 是 MessageLog → MessageLog 的纯变换
```

**KernelServices**：root/metaDir 路径、logger、FileWriteMutex（唯一实例）、ModelCatalog、`stores`（含 `forAgent(agentId)` agent 作用域存储注册表）、SessionPort。

### §2 模块映射

| 现有 | 目标 | 形态 |
|------|------|------|
| tools/index.ts 16 工具注册 | capabilities/fs、skill、changelog、render、agent-mgmt、interaction(approval/ask) | 每目录：工厂 + 工具 + port 声明 |
| trigger/ + TimerService | capabilities/trigger | 注入 SessionPort；工具与生命周期由 capability 承载 |
| mcp/ 连接管理 + context block | capabilities/mcp | config store 留在 store 层 |
| context/ 纯函数 | kernel + 各 capability | blocks union 拆散；compaction/serialize/token-estimate 进 kernel |
| session/live-session.ts | kernel AgentRunner + middleware | §3 |
| store/* | kernel 持久层（原样保留） | 去掉对 presets 直接 import（改 seed 注入） |
| model-providers | per-runtime ModelCatalog | 模块级导出保留为全局默认 facade（server 不动） |
| factory.ts / project-runtime.ts | 唯一装配点 assembleProject(root, capabilities[]) | 新增模块 = 新目录 + 此处一行 |

依赖方向严格单向：

```
capabilities/* ──► kernel(types/ports) ──► store / utils
                      ▲
              装配点（唯一知道一切的地方）
```

### §3 LiveSession 拆解（568 行 → 正交单元）

- **AgentRunner**：纯 turn 编排（sendMessage/retry/abort）。装配 prompt+tools+model → 驱动 Agent → 经管线发事件 → 在固定时机调用 TurnHooks。对 compaction/MCP 等能力零感知。
- **agent-assembly**：从 profile 构造 Agent（prompt blocks、tools 解析、model/streamFn、convertToLlm）。
- **EventPipeline**：可组合 middleware 链，每次 prompt 现建，消灭 setEventSink 开关。默认链：logMW · attachmentMW · persistMW(MessageLog)。
- **TurnHooks**：beforeTurn（MCP 合并）/ afterTurn（compaction 纯变换 `MessageLog → MessageLog` + 一次落库）/ onReload（重置 memo）。
- **ModelResolver**：resolveEffectiveModelId + catalog 查询收敛为单一服务。

不变量修复：`agent.state.messages[] ⟷ liveMessageDbIds[]` 双数组（下标手工对齐、compaction 双写）合并为 `MessageLog`（dbId 挂在消息上，单一事实源）。

reload/MCP 合并不再是 `pendingReload`/`mcpMerged` 散落 flag：capability 的 `contextBlocks()`/`tools()` 每次 turn 前按需重算，Runner 记忆化缓存——惰性求值替代可变标记。

### §4 状态与并发缺陷修复

| 缺陷 | 修复 |
|------|------|
| 双 FileWriteMutex | 唯一实例进 KernelServices，装配点注入两处（顺手修掉真 bug） |
| model-providers 全局可变单例 | ModelCatalog 实例 per-runtime；模块级导出转发到进程默认实例（server 零改动） |
| SessionContext 共享可变 | 拆为 RuntimeDeps（冻结：root/store/mutex/logger/catalog）+ RunConfig（model/sampling 只读快照，每 turn 读取） |
| setTriggerManager setter 缝合 | 装配点一次性构造注入（capability init 阶段），setter 删除 |
| store → presets 硬编码 | ProjectStore.open({ seed })，presets 内容由装配点传入 |
| digest 硬编码工具名 | extractToolArg 改通用规则（args 首 string 字段）+ capability 可注册 summarizeArgs 扩展点 |

### §5 Memory——验收用最小 Capability（per-agent）

memory 是 **by agent** 的：每个 agent 拥有私有记忆存储，contextBlocks 只注入当前会话所属 agent 的记忆。

- 存储：`.spherse/agents/<agentDir>/memory.jsonl`，追加式 JSONL；MemoryStore 惰性打开（与 AgentStore.skills 同模式），纯函数读取过滤 + 一次 append 写入。
- kernel 的 agent 作用域扩展点：ToolHost / SessionView 携带 agentId，`stores.forAgent(agentId)` 提供 capability 私有存储访问；onAgentDeleted 负责清理。
- 布局知识归 store：`MemoryStore` 模块导出 `MEMORY_PATH_RULE`（含路径正则、category、llm 读写裁决），capability 仅引用注册。

```ts
// capabilities/memory/index.ts —— 这就是接入的全部
import { MEMORY_PATH_RULE } from "./store.js";

export function memoryCapability(): Capability {
  return {
    id: "memory",
    pathRules: [MEMORY_PATH_RULE],
    tools: (host) => [createMemorySaveTool(host), createMemoryRecallTool(host)],
    contextBlocks: async (s) => [await buildMemoryBlock(s)],  // 当前 agent 的记忆
    onAgentDeleted: (id) => closeMemoryStore(id),
  };
}
```

**验收标准**：新增 memory 时 git diff 触碰的现有文件 = 装配点 1 行；tools/、session/、context/、store/、access/、server 全部零改动（pathRules 自带裁决，无需改中心允许集）。PR 中用 `git diff --stat` 直接证明。

### §6 渐进迁移路线

```
P0 地基     kernel/ 目录（类型、ports、EventPipeline、MessageLog）纯新增，不改旧码
P1 收 bug   双 mutex 合一；ModelCatalog 实例化 + 旧导出 facade 转发        ← 独立修 bug
P2 绞杀会话 LiveSession → AgentRunner + middleware；SessionContext 拆冻结 deps + RunConfig；
            server 入口签名不动（SessionManager 适配层转发）
P3 能力化   trigger / mcp / fs-tools / skill 逐个包成 capability（先外壳后掏空）；
            装配点从 factory.ts 平移到 assembleProject
P4 验收     memory capability 落地，diff 证明侵入面
```

每阶段收尾跑 `npm run verify` + 受影响面 E2E（chat/session、trigger、fs 工具）。

### §7 测试策略

- **kernel**：EventPipeline 组合律（顺序、短路、unsubscribe）、MessageLog 变换（append/compact/restore 下 dbId 不变量）、Capability 注册冲突检测——全新单测。
- **迁移不改行为**：现有 795 个 core 测试是回归基线，P2 起旧测试经适配层继续跑；live-session 测试逐步改写为对 AgentRunner 的等价断言。
- **memory**：自带单测 + 一条"侵入面" E2E（脚本断言 diff 只含预期文件）。
- **capability contract 测试**：给定 port mock，断言 tools/contextBlocks/lifecycle 行为——capability 可脱离整个项目独立测试（空间独立性的直接验证）。

## 达成方式总结

贡献即数据（Capability）、依赖即窄接口（Port）、横切即管线（Middleware）、状态即单源（MessageLog/冻结 deps）。新增模块侵入面从 7 处中心文件收敛到装配点一行。
