# App 前端架构 Follow-up

- 日期：2026-08-22
- 前置：PR #24（TanStack Query 服务端状态迁移）与 `packages/app/README.md`
- 状态：待排期；本文汇总已识别但不应继续塞入 PR #24 的架构优化

## 背景

PR #24 已完成第一阶段状态边界收敛：

- agents、sessions、文件内容、目录列表和文件路径索引迁入 TanStack Query；
- `project-data-store` 收缩为 initial message、streaming session id、trigger 标记等客户端运行时投影；
- fs-watch/reconnect 通过 bridge 统一转换为 query invalidation；
- Query 基础设施归入 `packages/app/src/queries/`；
- app 架构与编码规范集中到 `packages/app/README.md`。

当前架构已经具备清晰的 server state / client state 边界。后续重点不是继续扩大 TanStack Query 的使用范围，而是减少聚合查询、重复实体、跨 store 镜像和本地服务端快照。

## 原则

1. 服务端或磁盘是事实源的数据由 TanStack Query 管理。
2. 本地交互状态由组件或 Zustand 管理，不进入 Query。
3. 不为“结构更漂亮”做无消费者重构；按痛点和触发条件推进。
4. 每个阶段可独立交付、独立验证，不要求一次性完成全部事项。
5. 优先消除正确性风险，再处理文件拆分和开发体验。

## 优先级总览

| 优先级 | 事项 | 主要收益 | 建议触发条件 |
|---|---|---|---|
| P0 | 拆分 `useProjectCatalog` | 减少无关 session observer、请求和重渲染 | 下次修改 agent/session 查询 |
| P0 | 统一 session detail cache | 消除列表/详情双份实体同步 | 下次修改深链或 UI SDK session lookup |
| P1 | 拆分 `queries/project.ts` | 降低查询、mutation、生命周期混杂复杂度 | 文件超过可维护阈值或新增第三个 project query 域 |
| P1 | 文件树改为目录 Query + expandedPaths | 删除递归服务端快照和复杂 merge | 下次大改文件树或 fs-watch |
| P1 | 移除 streaming/trigger 镜像 | 消除跨 store 手工同步 | 下次修改 SessionRow/AgentRow 状态来源 |
| P1 | 标准化 React mutation hooks | 统一 pending/error/乐观更新 | 出现第二个需要 mutation 状态的消费方 |
| P2 | 迁移 dialog 服务端状态 | 删除 load-on-open effect 模板 | 逐个 dialog 功能修改时顺带迁移 |
| P2 | 收敛项目级 bridge | 控制 ProjectScope 基础设施膨胀 | bridge 数量继续增长时 |
| P2 | 建立组件测试基础设施 | 提升交互与 Query 边界测试质量 | 开始批量补组件测试时 |

## P0：拆分聚合查询

### 现状

`useProjectCatalog(projectId, client)` 同时订阅 agents 与 sessions。只需要 agent 名称或 slug 的组件也会成为 session catalog observer，例如 MCP dialog、trigger dialog 和 trigger bridge。

TanStack Query 会去重网络请求，但多余 observer 仍会：

- 让组件订阅无关状态变更；
- 扩大 loading/error 耦合；
- 让“这个组件为何需要 sessions”难以从调用点判断；
- 增加后续拆分 query policy 的成本。

### 目标

提供窄 hook：

```ts
useProjectAgents(projectId, client)
useProjectSessions(projectId, client, agents)
useProjectSession(projectId, client, sessionId)
```

只有同时需要 agents、sessions 和 paging 的组件使用聚合 facade；若聚合 facade 没有多个消费者，则直接删除。

### 验收标准

- MCP/Trigger 等只读 agent 元数据的组件不订阅 session catalog；
- session query 的 enabled 条件和 agent 依赖从调用关系中可见；
- 不增加第二套 query key 或服务端状态缓存；
- agents/session 的项目隔离和 invalidation 测试继续通过。

## P0：统一 session detail cache

### 现状

同一 session 可能同时存在于：

```text
["projects", projectId, "sessions"]
["projects", projectId, "session", sessionId]
```

TanStack Query 不提供 Apollo 式实体归一化，因此列表与详情不会自动同步。当前 query 层需要显式从 catalog 找实体、seed detail key，并在 rename/delete 时同步两处。

### 目标

列表查询成功后统一 seed session detail key。React 和命令式调用均通过同一 detail query options/facade 读取 session：

```ts
sessionQueryOptions(projectId, client, sessionId)
queryClient.ensureQueryData(sessionQueryOptions(...))
```

调用方不读取 catalog 内部结构，不自行实现 cache-first fallback。

### 服务端配套建议

增加不需要 agentId 的直接查询接口：

```http
GET /api/projects/:projectId/sessions/:sessionId
```

当前深链查询在缓存未命中时需要枚举 agents 并调用 `listSessions()`；直接接口可降低请求数量，也能明确区分 404 与瞬时错误。

### 验收标准

- session 的命令式读取只有一个公开入口；
- rename/delete/create 后列表和详情不会分叉；
- 深层分页 session 可直接打开和浮窗；
- 404 才视为不存在，网络/服务端错误不会清理 UI 状态；
- 新增列表 seed、mutation 同步、404、瞬时错误测试。

## P1：拆分 project query 模块

### 现状

`queries/project.ts` 同时承载：

- query hooks；
- session catalog 与分页算法；
- agent/session mutations；
- cache 更新和 invalidation；
- project generation 生命周期保护；
- UI SDK/bus 使用的命令式 facade。

该文件目前仍可维护，但继续加入 settings、trigger 或更多 session policy 后会形成新的聚合模块。

### 建议结构

```text
queries/project/
├── agents.ts       # query options、hooks、agent mutations
├── sessions.ts     # list/detail options、分页、session mutations
├── lifecycle.ts    # generation、project close/cancel/remove
└── index.ts        # 仅导出外部消费面
```

全局 `queries/keys.ts` 与 `queries/client.ts` 保持独立。

### 验收标准

- 模块按领域职责拆分，不仅是按函数数量搬文件；
- 对外导出清单最小化；
- 生命周期保护不会被 mutation 绕过；
- 不产生循环依赖。

## P1：文件树改为目录 Query + expandedPaths

### 现状

目录直接 children 已存入 Query，但 `useFileTreeController` 又维护一棵包含服务端 children 的递归本地树。每次 invalidation 后需要递归重取并通过 `mergeRefreshedTree` 合并最新服务端数据与展开状态。

这种双重表示带来：

- 服务端 children 在 Query 和组件 state 中重复；
- 异步重建与用户展开/折叠存在竞态；
- 创建、删除和 fs-watch 需要特殊 refresh 流程；
- merge 算法容易保留旧 children 或覆盖新交互状态。

### 目标

Query 只保存每个目录的直接 children，本地仅保存交互状态：

```ts
expandedPaths: Set<string>
creating: CreatingState | null
deleteTarget: TreeNode | null
```

目录节点按需渲染对应 `useProjectDirectory(projectId, client, path)`；折叠不删除缓存，展开时复用或重取目录数据。

### 设计注意

- React hook 不能在普通递归函数中动态调用，应让每个目录节点组件拥有自己的 query hook，或使用 `useQueries` 管理当前 expandedPaths；
- 根目录与子目录使用同一种 query shape；
- create/delete 只失效父目录、相关 content 和 file-tree index，不全量重建整棵树；
- 展开状态与目录加载状态分离，Query pending 不等于 collapsed。

### 验收标准

- 本地 state 不再保存服务端 children 快照；
- 删除 `mergeExpandedState` / `mergeRefreshedTree` 或将其缩为纯 UI 状态辅助；
- fs-watch 可按父目录精准失效；
- 保持创建、删除、嵌套展开、重连和项目切换 E2E 覆盖。

## P1：移除跨 store 状态镜像

### 现状

`project-data-store` 仍保存两个由 feature 状态派生的镜像：

- `streamingSessionIds`：由 chat streaming store 手工回写；
- `hasEnabledTriggersByAgent`：由 trigger store/bridge 手工回写。

镜像依赖多个写入点保持一致，漏写会导致 sidebar indicator 与真实状态分叉。

### 目标

- `SessionRow` 直接订阅 streaming store 的目标 session 状态，或由 chat feature 暴露窄 selector hook；
- `AgentRow` 从 trigger query/store 派生 enabled 状态；
- `project-data-store` 最终只保留 initial-message handoff，若 handoff 也能归入 chat runtime，则删除整个 store。

### 边界要求

直接读取另一个 feature-local store 与现行“feature-local 不跨 feature import”规则冲突。实施前应选择一种稳定边界：

1. 将这些 indicator 投影提升为 app 级 runtime store；或
2. 由拥有者 feature 导出窄的 public selector hook；或
3. 在编排层读取后通过展示 props 传入。

不要简单删除镜像后改成任意跨 feature import。

### 验收标准

- 每个 indicator 只有一个事实源；
- streaming/trigger 写路径不再反向写 `project-data-store`；
- 关闭项目会释放对应运行时状态；
- sidebar indicator 的组件测试和 E2E 保持通过。

## P1：标准化 React mutation hooks

### 现状

agent/session 写操作是 query 层命令式函数。它适合 UI SDK 和 bus 边界，但 React 组件需要自行维护 pending/error、toast 和 dialog 生命周期。

### 目标

保留底层命令式 service，同时为 React 消费方提供：

```ts
useCreateSessionMutation()
useRenameSessionMutation()
useDeleteSessionMutation()
useCreateAgentMutation()
```

统一 mutation key、pending/error、乐观更新、失败回滚和 invalidation。

### 验收标准

- React 组件不重复 `.then(() => true).catch(() => false)`；
- UI SDK 继续复用同一底层 service，而不是调用 React hook；
- 乐观更新有失败回滚测试；
- mutation 完成晚于项目关闭时不会重建 cache。

## P2：迁移 dialog 服务端状态

按修改机会逐个迁移，不建议单独做全量大 PR。

候选项：

- agent MCP 配置；
- trigger 配置和日志；
- session status；
- welcome page / theme project settings；
- AI read denylist；
- agent edit detail。

统一模式：

- `enabled: open` 控制按需读取；
- Query 管远端 snapshot、loading 和 error；
- mutation 管写入与失效；
- draft、tab、确认弹窗继续留组件本地。

验收标准：删除重复的 load-on-open `useEffect + useState + cancelled flag` 模板，切换 locale 不触发无关重取。

## P2：收敛项目级 Bridge

### 现状

`ProjectScope` 挂载 `UiSdkBridge`、`TriggerEventBridge`、`ContentQueryBridge` 以及多个项目级 hook。当前数量仍可接受。

### 触发条件

新增两个以上项目级 bridge，或 ProjectScope 再次混入 feature-specific 生命周期逻辑。

### 目标

收敛为：

```tsx
<ProjectRuntimeBridges />
```

该组件仅负责挂载自治 bridge，不成为新事件总线或 service locator。

## P2：组件测试基础设施

### 现状

组件测试主要直接使用 `createRoot` / `act`，Provider 和 QueryClient 由每个测试手工拼装；结构测试较多，行为测试层相对薄。

### 目标

引入 Testing Library 与统一测试 wrapper：

```ts
renderApp(ui, {
  project,
  queryClient,
  hostBridge,
})
```

### 覆盖重点

- Query provider 与项目隔离；
- loading/error/empty 状态；
- mutation 后缓存更新；
- dialog、菜单和键盘交互；
- fs-watch/reconnect 后 UI 更新；
- active editor draft 不被共享 query 更新覆盖。

结构测试仍可用于少量不可变 DOM hook 契约，不作为主要组件行为保障。

## 建议实施顺序

1. 拆 `useProjectCatalog`。
2. 统一 session detail cache，并评估服务端直接 session endpoint。
3. 移除 streaming/trigger 镜像。
4. 文件树改为目录 Query + expandedPaths。
5. 为 React 消费方补 mutation hooks。
6. 随 feature 修改逐步迁移 dialog 查询。
7. bridge 与测试基础设施按触发条件推进。

前两项可作为同一个“小范围 Query API 收敛”PR；文件树重构应独立 PR，避免与 session cache 语义混在一起。

## 明确不做

- 不把 WebSocket transport、chat token 流、编辑器 draft 或浮窗几何状态迁入 TanStack Query。
- 不引入 Apollo 式通用实体归一化层；session 先用明确的 list/detail seed 规则解决。
- 不为了目录整齐立即拆 `queries/project.ts`，必须满足触发条件。
- 不把多个 bridge 合成新的全局事件总线。
- 不在没有用户体验问题时替换 Zustand。
