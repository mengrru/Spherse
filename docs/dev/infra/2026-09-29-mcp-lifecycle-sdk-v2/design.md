# MCP 生命周期修复 + SDK v2 迁移（2026-07-28 协议）设计

- 日期：2026-09-29
- 状态：reviewed（review 反馈已处理，见文末）

## 背景与目标

对现有 MCP 实现（`packages/core/src/mcp/`、`packages/core/src/capabilities/mcp/`）的 review 发现六处生命周期缺陷（P1-P6，见下表）；同时 MCP 规范发布 `2026-07-28` 版本，核心变更为**无状态化**（删除 `initialize` 握手与协议级 session，每请求携带 `_meta` 元数据，新增 `server/discover`），并正式 deprecated Roots/Sampling/Logging 与 HTTP+SSE transport。TS SDK 已拆分为 v2 模块包（`@modelcontextprotocol/client@2.x` 支持 2026-07-28 + era 自动协商；v1.x `@modelcontextprotocol/sdk` 进入纯维护线，不会支持新协议）。

本设计一并处理：修复 P1-P6、迁移 SDK v2、移除 sse transport（用户决策：不保留兼容，直接删除）。

### 已确认的产品/技术决策

1. P1-P6 与 SDK v2 迁移一起做，sse transport 直接删除不留兼容
2. 我们是纯 client（host），不实现 roots/sampling/logging，新协议 deprecation 无影响
3. 不实现 elicitation（client capabilities 保持 `{}`；server 端 MRTR 需求会得到错误并转为工具错误文本，现状语义）
4. 跟进新协议的方式是升级 SDK 而非自实现：`@modelcontextprotocol/sdk@1.29.0` → `@modelcontextprotocol/client@^2.1.0`
5. retry 路径丢 MCP 工具的既有 hole（backlog:34）随本设计一并修复（见决策表「retry 路径」）——否则 P2 的 emit 决策会扩大该 hole 的触发面

### 问题清单（review 结论，代码证据）

| # | 问题 | 证据 |
|---|---|---|
| P1 | 连接失败被永久缓存、无重试路径：`defaultConnect` 用 `Promise.allSettled` 吞掉全部失败 → 空结果无条件入缓存 | `mcp-connection-manager.ts:24-47,90-91` |
| P2 | MCP 配置变更后活跃会话残留旧工具与旧 systemPrompt：`beforeTurn` 只追加；`updateAgentMcp` 不 emit `agent_updated`，不触发 reload | `capabilities/mcp/index.ts:76-81`、`project-manager.ts:133-140`、`store/project.ts:203-211`（对比 `updateAgent`） |
| P3 | 无断线检测/重连：全仓库无 `onclose`/`onerror` 处理；stdio 子进程崩溃后工具调用持续报错，需人工改配置恢复 | 全局 |
| P4 | `invalidate`/`closeAll` 不管 inflight connect：连接完成后照样入缓存 → 泄漏（孤儿 stdio 进程） | `mcp-connection-manager.ts:52,86-95,102-117` |
| P5 | `client.connect(transport)` 无显式超时，SDK 默认 60s，首条消息可被握手阻塞 | `mcp-client.ts:395` |
| P6 | stdio stderr 缓冲无界增长（listener 永不移除） | `mcp-client.ts:387-392` |

次级问题顺带处理：`mcp-client.ts:431-434` stale 注释（引用不存在的 `live-session.ts`）。明确不修（维持 backlog）：invalidate 关闭正在使用中的连接（错误已优雅转文本）、全量重连无 per-server diff、无 idle 回收。

## 新协议关键事实（影响设计的部分）

- `@modelcontextprotocol/client@2.1.0`：`Client` / `StreamableHTTPClientTransport` 从主入口导入，`StdioClientTransport` 从 `@modelcontextprotocol/client/stdio` 导入
- `client.connect(transport, options)` 新增 options（含 `timeout`/`signal`）；list 类方法同样接受 `signal` → P5 用单 server 总预算 AbortSignal 实现
- `Client` 暴露公开 `onclose` / `onerror` 回调 → P3 的检测信号
- `versionNegotiation` 选项：默认 `'legacy'`（等价旧行为）；`'auto'` 用 `server/discover` 探测（stdio 会 spawn 一次性探测进程），协商后 `getProtocolEra()` 可查
- list 类方法自动聚合分页（默认上限 64 页，超出抛 `SdkError`）；server 未声明 capability 时返回空列表而非抛错；`ttlMs`/`cacheScope` 是线上字段，公开类型未静态声明（经 `_meta` loose passthrough 保留）
- zod 从 peerDep 改为普通依赖（zod@4），我们只用 SDK 推导类型 + 运行时 Client，不受影响
- v1→v2 有官方 codemod；我们仅 3 个 import 点 + Client 用法，手改即可
- desktop 打包无新增变量：main 走 `externalizeDepsPlugin` 运行时解析 node_modules，v2 同为 ESM/CJS 双格式（实现时确认 `./stdio` 子路径 exports 解析即可）

## 决策

| 决策点 | 结论 |
|---|---|
| SDK 与协商模式 | 依赖换为 `@modelcontextprotocol/client@^2.1.0`；Client options 设 `versionNegotiation: { mode: "auto" }`。风险：stdio 每 server 多一次探测进程 spawn（连接是低频操作，接受）；若实测有问题，降级 `'legacy'` 只改一处配置 |
| P1 缓存粒度 | manager 缓存从「agent 级全量 entry」改为「agent 内 per-server entry」：成功的 server 缓存 tools/connection；失败的 server 记 `nextRetryAt` 退避（30s 起，×2，封顶 10min），到点后下一 turn 重连；成功即重置退避。失败不再污染整个 agent 的工具集 |
| P1/P3 失效信号 | 以 **revision 计数器**（per-agent）取代 configVersion：invalidate、server 意外断线（`client.onclose`）、server 状态迁移（fail→ok / ok→fail）时 bump。`beforeTurn` 以 `mergedAtRevision !== revision` 判断是否重合并 |
| P2/P3 会话内自愈 | **不依赖** `applyReload` 重建：`beforeTurn` 检测 revision 变化时，先**剥离**上次合并的 MCP 工具与 context block（工具按 `mcp__` 名字前缀过滤——该前缀由 `makeMcpToolName` 生成，dedupe 后缀派生名同样携带前缀；builtin 工具无一以此前缀开头，`mcp__` 声明为保留命名空间），systemPrompt 用 sentinel 标记对剥离，再合并新结果。配置变更与断线重连走同一条自愈路径，mid-turn 断线不破坏当轮（调用失败转错误文本，现状语义） |
| P2 持久层信号 | `ProjectStore` 新增 `updateAgentMcp`（save + `emitAgentChange("updated")`，镜像 `updateAgent` 模式），`ProjectManager.updateAgentMcp` 委托之。已核查 `agent_updated` 全部消费方：SessionManager（markReloadPending，见下行 retry 修复）与 server WS 广播（`useAgentBusRefresh` 仅 refetch agents 列表，无重副作用） |
| retry 路径（backlog:34 随修） | `retryLastTurn` 命中 pendingReload 执行 `applyReload` 后**补调 `turnHooks.beforeTurn`**——retry 与 sendMessage 共用 turn 前置语义，MCP save 后 retry 不再整轮丢 MCP 工具。完成后删除 backlog:34 条目 |
| P4 竞态防护（epoch） | **per-agent epoch**（`Map<agentId, number>`）：`invalidate(agentId)` bump 该 agent；`closeAll()` bump 全部。per-server 连接尝试开始前快照该 agent epoch，完成后校验：不符则立即关闭新建连接、不缓存、不 bump revision；该次 load 对该 agent 返回 `{tools:[], info:[]}`（调用方拿不到死连接的工具） |
| 并发防护（load 串行化） | `inflight` 去重从「仅首次全量连接」扩为**覆盖整次 load pass**（含到期失败 server 的重连）：`load(agentId)` 若已有 in-progress pass 则 await 之再读缓存。同 agent 多 session 并发 turn 不会对同一 due server 重复 spawn |
| P5 超时 | 单次 server 连接尝试**总预算 20s**：manager 为每次尝试创建 `AbortSignal.timeout(20_000)` 传入 `connectMcpServer`，内部 connect 与全部 list 调用共用该 signal；超时/中止走既有 catch → close client → 标记失败进退避。`callTool`/`readResource`/`getPrompt` 不受影响（agent 侧 AbortSignal 透传，SDK 默认 60s 保留给长任务工具）。接受的单 turn 阻塞上界 ≈ 20s（多 server 并行），写入风险节 |
| P6 stderr | 缓冲封顶 8KB（保留尾部），connect 成功后移除 listener 并丢弃缓冲；失败路径保留现有「stderr 进日志」行为 |
| 断线回调语义 | `closedByUs` 标志在**发起 close 之前**置位且不复位，主动 close（含 close 抛错/挂起）触发的 onclose 不 bump revision。`McpConnection.close()` 内部加 5s 超时兜底（`Promise.race`），stdio close 挂起不拖住 invalidate/closeAll/shutdown 链 |
| sse 移除 | `McpTransportType` 收窄为 `"stdio" \| "http"`；`normalizeMcpConfig` 遇 `transport: "sse"` 条目丢弃并 warn（不迁移不兼容——用户数据中 sse server 直接失效，下次整表保存后从 mcp.json 消失）；contracts schema 删除 sse variant；`mcp/index.ts` 导出面删 `McpSseServerConfig`；UI 侧 `TRANSPORT_OPTIONS` 删 `"sse"` + 类型收窄（draft 转换走通用非 stdio 分支，无独立 sse 分支可删）；i18n 三 locale 删 `agent-mcp.transport-sse` key。v2 SDK 中 SSEClientTransport 已 deprecated，直接不引用 |
| normalize 的 warn 通道 | `normalizeMcpConfig` 为纯函数，增加 optional `onWarn?: (entry, reason) => void` 回调参数（不塞 logger 依赖）；`McpConfigStore` 构造时接收可选 logger（由 `AgentStore` 传入）并在 getConfig/saveConfig 调 normalize 时转 warn |
| 分页 | 删除自研 `paginate`/`MAX_PAGES`，用 SDK 自动聚合；`ListPaginationExceeded` 捕获后转**空列表 + warn**（与现状「部分结果」略异：64 页上限本身即病态 server，接受） |
| MRTR / input_required | 不启用（client capabilities 无 elicitation）；server 返回 `input_required` 或 `MissingRequiredClientCapability` 错误时走现有「错误转文本」路径 |

## 契约

### `McpConnectionManager`（重构后）

```ts
interface ServerEntry {
  config: McpServerConfig;
  connection?: McpConnection;   // 成功后存在
  tools: AgentTool[];           // 成功前为 []
  info?: McpServerInfo;
  lastError?: string;
  attempts: number;             // 连续失败次数（退避计算）
  nextRetryAt?: number;         // 失败后重试门槛时间戳
}

class McpConnectionManager {
  // entries: agentId -> Map<serverId, ServerEntry>
  // inflight: agentId -> Promise<void>（整次 load pass，含重连）
  // epochs: agentId -> number
  load(agentId): Promise<{ tools: AgentTool[]; info: McpServerInfo[] }>;
  //   pass 内：读缓存可用 server + 对「到期失败/无 entry 且 enabled」server 并行重连（每个 20s 预算）
  //   epoch 校验失败的 server：关闭连接不缓存；整次 pass 全部失效时返回空集
  //   pass 结束后缓存读取：已缓存未到期的失败 server 贡献空集（不阻塞）
  revision(agentId): number;    // invalidate / 意外断线 / 状态迁移时 bump
  invalidate(agentId): Promise<void>;  // bump epoch + 关闭该 agent 全部连接清空 entries + bump revision
  closeAll(): Promise<void);    // bump 全部 epoch + 关闭全部
}
```

- `connectMcpServer(config, logger, opts?: { signal?: AbortSignal; onDisconnect?: () => void })`：`signal` 透传 connect 与 list；连接成功后挂 `client.onclose`（v2），`closedByUs` 标志见决策表；`close()` 带 5s 超时兜底。manager 消费 onDisconnect：drop 该 server entry + bump revision（重连由下一 turn 的 load pass 发起）

### mcp-context sentinel

block 渲染结果包裹：`\n\n<!-- spherse:mcp-context:start -->\n${...}\n<!-- spherse:mcp-context:end -->`，beforeTurn 剥离时按标记对移除（无标记的旧内容不存在——systemPrompt 是运行时态，不持久化，无迁移问题）。

### 数据格式

`mcp.json` 格式不变，唯一变化：`transport: "sse"` 条目变为非法（normalize 丢弃 + warn）。按仓库红线「持久化兼容只针对已发布数据」，sse 已随 release 发布过，但用户明确决策直接删除不保留兼容——丢弃行为本身即决策落地，写入 data-conventions.md。

## 各层实现

### packages/core

- `package.json`：`@modelcontextprotocol/sdk` → `@modelcontextprotocol/client@^2.1.0`
- `mcp/mcp-client.ts`：import 路径换 v2；删 SSE 分支；`connectMcpServer` 接受 `signal`/`onDisconnect`、内部 close 5s 兜底；stderr 封顶 + 成功后解绑；删自研分页；修 stale 注释
- `mcp/mcp-connection-manager.ts`：按上方契约重构（per-server entry、退避、revision、per-agent epoch、load pass 串行化、20s 预算）
- `mcp/types.ts` / `mcp/config.ts`：删 `McpSseServerConfig`、`"sse"`；normalize 增 `onWarn`、丢弃 sse 条目
- `mcp/index.ts`：导出面删 `McpSseServerConfig`
- `capabilities/mcp/index.ts`：memo 基准换 `revision(agentId)`；beforeTurn 重合并前剥离旧 `mcp__` 工具与 sentinel block
- `capabilities/mcp/block.ts`：渲染包裹 sentinel
- `store/mcp-config.ts`：接收可选 logger、转 normalize warn
- `store/project.ts`：新增 `updateAgentMcp`（save + emit updated）；`project-manager.ts` 委托
- `session/agent-runner.ts`：`retryLastTurn` 在 applyReload 后补调 `turnHooks.beforeTurn`
- `project-runtime.ts`：`updateAgentMcp` 流程不变（save 已含 emit，随后仍 `dispatchAgentConfigChanged` → invalidate）

### packages/contracts

- `agents.ts`：`mcpServerConfig` union 删 sse variant（schema 校验层拒绝）

### packages/app

- `agent-mcp/mcp-form-helpers.ts`：`TRANSPORT_OPTIONS` 删 `"sse"`、类型收窄（无独立 draft 分支）
- `McpServerForm.tsx`：传输方式选项只剩 stdio/http
- i18n 三 locale：删 `agent-mcp.transport-sse`；`agent-mcp.*Url*` 等注释中的「http/sse」改「http」

## 测试

- `mcp-connection-manager.test.ts` 重写：per-server 成败混合（成功缓存、失败退避）；退避到期后重连成功重置（fake timers）；失败期间 load 不重试未到期 server；并发 load（同 agent 两调用）对同一 due server 只连一次；onDisconnect → entry drop + revision bump；主动 close（含 close 抛错）不 bump；epoch：inflight 期间 invalidate/closeAll → 新连接被关闭不缓存、await 中的 load 返回空集；**invalidate 仅影响目标 agent**（其他 agent inflight 不被误废）；onDisconnect 与同 server in-flight 重连并发（旧连接断开时重连进行中，完成后 entry/revision 终态正确）
- `mcp-client.test.ts`：适配 v2 import；onDisconnect 接线（connect 后触发 transport close → 回调）；`closedByUs` 抑制主动 close 回调；**P5：signal 超时（fake timers，20s 预算）→ 连接尝试失败**（list 挂起场景同测）
- `connect-stdio.test.ts`：stderr 封顶（>8KB 输出只留尾部）；保留现有启动失败 stderr 捕获用例
- `capabilities/mcp`（p2-behaviors.test.ts 更新 + 新用例）：revision 变化 → 旧 `mcp__` 工具被剥离后重合并（含 dedupe 派生名）；sentinel block 剥离不重复叠加；配置删除 server 后下一 turn 工具集正确；**retry 路径：MCP save 后 retryLastTurn 仍带 MCP 工具**
- `store/project` 层：`updateAgentMcp` emit `agent_updated`（镜像 `updateAgent` 的既有测试模式）
- `config.test.ts`：sse 条目被丢弃 + onWarn 收到通知
- contracts 测试：sse variant 被 schema 拒绝
- E2E：MCP 无既有 spec，不新增（分层选型规则：本变更主战场在 core 单测）

## 实施顺序

1. SDK v2 迁移（deps、imports、分页简化、协商模式）+ 既有测试适配 —— 纯机械迁移，不含超时（独立 commit）
2. manager 重构（P1/P3/P4）+ mcp-client signal 超时/stderr/onDisconnect/close 兜底（P5/P6）—— 独立 commit
3. beforeTurn 自愈 + store 层 emit + retry 补调 beforeTurn（P2，含 backlog:34 随修）—— 独立 commit
4. sse 移除（core/contracts/app/i18n）—— 独立 commit
5. `npm run verify` + doc-sync

## 文档同步（doc-sync 清单预填）

- `docs/official/architecture/capabilities.md`：MCP 章节更新（revision 自愈合并、per-server 缓存与退避、20s 预算、v2 SDK/协议版本、`mcp__` 保留前缀声明）
- `docs/official/data-conventions.md`：mcp.json 条目删除 sse transport 说明
- `docs/dev/decisions/`：新增 ADR（SDK v2 迁移 + 2026-07-28 协议跟进 + sse 移除决策）
- `packages/core/README.md`：如涉及 MCP 描述则同步
- backlog：删除 backlog:34（retry 丢 MCP 工具，随修）；视实测新增「stdio era 探测进程开销评估」条目
- i18n：删 key 三 locale（走 i18n skill 规则）

## 风险

- **单 turn 阻塞上界 ≈ 20s**（多 server 并行连接的最坏情况；beforeTurn 在 user message 落盘前执行是现状时序，本设计不改变该时序，只把无上界（60s+/串行 list 可达数分钟）压到 20s）。退避保证病态 server 最多每 30s~10min 阻塞一次 turn
- v2 SDK `auto` 协商对 stdio server 多一次探测 spawn：若个别 server 探测行为异常（如 side effect 进程），降级 `'legacy'` 模式或按 server pin——留 backlog 条目跟踪
- v2 行为差异：list 空 capability 返回空列表（我们原本也捕获转空，语义等价）；`SdkError` 错误类型与 v1 `McpError` 不同——现有 catch 分支仅用 message 无类型分支，已核实
- `mcp__` 前缀剥离依赖命名约定：已在 capabilities.md 将 `mcp__` 声明为保留前缀，未来 profile 层工具不得使用
- sse 移除对存量用户是 breaking：依赖此功能的 server 配置静默失效（warn 日志 + UI 不再显示），用户决策已确认接受

## Design review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| I1 | important | epoch 全局 vs per-agent 矛盾：单全局计数器下 invalidate(agentA) 会误杀 agentB 的 inflight 连接 | 采纳：改为 per-agent epoch（`Map<agentId, number>`），closeAll 才 bump 全部；契约与决策表已更新 |
| I2 | important | per-server 重连与 agent 级 inflight 竞态：同 agent 多 session 并发 load 对同一 due server 重复 spawn → P4 泄漏在新路径复发 | 采纳：inflight 扩为覆盖整次 load pass（含重连），同 agent load 串行化；补并发测试用例 |
| I3 | important | emit agent_updated 使 retry 从「残留旧工具」恶化为「整轮丢 MCP 工具」（retry 不调 beforeTurn），扩大 backlog:34 触发面 | 采纳：backlog:34 随本设计修复——retryLastTurn 在 applyReload 后补调 beforeTurn；补 retry 路径测试；完成后删 backlog 条目 |
| M1 | medium | 重连在 beforeTurn 内，最坏阻塞无上界（connect 60s + 串行 list 可达数分钟），且发生在 user message 落盘前 | 采纳：单 server 连接尝试总预算 20s（AbortSignal 贯穿 connect + list），风险节明示阻塞上界与退避降频 |
| M2 | medium | epoch 校验失败后 load 返回值未定义，调用方可能拿到死连接工具 | 采纳：契约明确返回空集；补断言 |
| M3 | medium | P5 超时无测试覆盖 | 采纳：fake timers 用例（connect 挂起 / list 挂起 → 失败进退避） |
| M4 | medium | normalizeMcpConfig 纯函数无 logger 通道，「丢弃并 warn」缺实现路径 | 采纳：normalize 增 optional onWarn 回调；McpConfigStore 接收可选 logger 转发 |
| m1 | minor | P5 超时 commit 归属前后矛盾（commit 1 与 2 都写） | 采纳：超时统一归 commit 2，commit 1 纯迁移 |
| m2 | minor | sse 移除漏 `mcp/index.ts` 导出清理；app 侧「draft 转换删 sse 分支」描述不准（无独立分支） | 采纳：实现清单补 mcp/index.ts；app 侧描述修正为 TRANSPORT_OPTIONS + 类型收窄 |
| m3 | minor | 分页超限语义：现状 paginate 返回部分结果，设计写「转空列表」未说明差异 | 采纳：明确为空列表 + warn，差异（64 页上限病态 server）写入决策表 |
| m4 | minor | closedByUs 边界（须 close 前置位、close 无超时兜底）未写明 | 采纳：决策表补「close 前置位不复位」+ close 5s 超时兜底；补 close 抛错测试 |
| m5a | minor | 缺 onDisconnect 与 in-flight 重连并发的测试场景 | 采纳：加入 manager 测试清单 |
| m5b | minor | 多 session 共享 entry 的并发调用测试 | 不加：属验证性用例，SDK Client 并发 JSON-RPC 安全已有保证，测试矩阵保持克制 |
| 疑点 | — | desktop 打包对 v2 ESM/CJS 的兼容 | 无发现：externalizeDepsPlugin 运行时解析 + 双格式，实现时确认 ./stdio 子路径解析即可 |

## Code review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| I1 | important | server 消费方对 `updateAgentMcp` 写入门面零契约测试（仓库红线） | 已修：新增 `agent-mcp-contract.test.ts`（真实 runtime 经真实路由：PUT 落盘 + `agent_updated` 广播 + sse 400 + 404 映射） |
| M1a | medium | design 承诺「onDisconnect 与同 server in-flight 重连并发」用例缺失；且迟到 onclose 可能误删同 serverId 新 entry | 已修：`handleDisconnect` 增加「当前 entry 连接已死才删除」守卫；补「迟到 onclose 不删新 entry」用例 |
| M1b | medium | 「主动 close（含 close 抛错）不 bump」的 close 抛错变体无覆盖 | 已修：manager 测试补 `invalidate tolerates a connection whose close rejects` |
| M1c | medium | retry 路径三层各自有测试、接缝无端到端断言 | 已修：新增 `retry-mcp-integration.test.ts`（真实 runtime + mock 连接层：updateAgentMcp → markReloadPending → retryLastTurn 后 tools 含 mcp__ 工具 + block 正确） |
| M2 | medium | guard race 的「握手成功但 tools/list 挂起」路径无用例 | 已修：fixture 增 `FIXTURE_HANG_TOOLS_LIST` 变体，signal 预算内 reject |
| m1 | minor | 迁移保留的 4 行 synthetic tools 注释违反「不添加注释」红线 | 已修：删除 |
| m2 | minor | `McpNormalizeWarnFn` 无外部消费者却从 index 导出 | 已修：撤下导出 |
| m3 | minor | retry 的 beforeTurn 在「无 failed turn」校验之前执行（与 sendMessage 顺序不一致） | 已修：移到校验与 ensureModel 之后 |
| m4 | minor | sentinel 剥离 regex 非贪婪，server 文本含伪造 end 标记时截断累积 | 已修：贪婪化（至最后一个 end），prompt 卫生残余风险接受（MCP server 半可信） |
| m5 | minor | server PUT /mcp catch-all 把非 NotFound 错误误报 404 | 不修：pre-existing 行为，本分支未扩大，记录 |
| 疑点1 | — | v2 onclose 在 connect resolve 与赋值之间的丢失窗口 | 核实不成立：赋值与 connect resolve 在同一同步段，事件不会插入 |
| 疑点2 | — | closeQuietly 兜底输掉后的孤儿进程 | 接受：backlog 已有「MCP close 异步无界」既有条目覆盖 |
