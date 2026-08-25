# 项目级 Sessions 批量接口设计

- 日期：2026-08-26
- 状态：已实施

## 背景与问题

Session 列表接口是 by-agent 的（`GET /api/projects/:projectId/agents/:agentId/sessions`）。前端要渲染项目完整会话目录时必须扇出：

1. **主路径**（`packages/app/src/queries/project.ts` `fetchProjectSessionCatalog`）：等 agents 查询成功（瀑布第一跳）→ `Promise.all` N 个 `listSessionsPage` → 归并。为消化"归并期间用户 load more 抬高 offset"的并发竞态，还写了 generation 重试 + optimistic 保留逻辑（约 30 行复杂度）。
2. **Deep-link 回退**（`findProjectSession`）：session 缓存未命中时再次 N 并发扇出全量列表逐个找 id。

agent 数量增长时请求量线性增长；打开项目侧栏的首屏时延 = agents 请求 + max(N 个 sessions 请求)。

## 决策

| 决策点 | 结论 |
|---|---|
| 接口粒度 | 新增项目级批量端点 `GET /api/projects/:projectId/sessions`，一次返回全项目 active sessions |
| 分页模型 | 方案 B：保留 per-agent 分页语义——每个 agent 取前 `perPage` 条归并，响应携带 `byAgent` 游标；分组"加载更多"继续走既有 by-agent 端点 |
| 聚合位置 | core `ProjectManager.listProjectSessions(perPage)`（跨 agentStore 归并），server route 保持薄 |
| 旧端点 | 全部保留（UI SDK `sessions.list`、load more、单 agent CRUD 仍在用），纯增量 |
| Trigger 批量接口 | 本次不做，记入 followup |

### 为什么选 B（per-agent 分页）而不是 A（全局分页）

UI（`AgentSessionListView`）按 agent 分组渲染、每组独立"加载更多"。全局 `limit/offset` 分页的页边界无法回答"agent X 是否还有更多"，要么重构为全局加载更多、要么放弃分组加载。B 方案 UI 零改动拿到全部收益（消扇出、消瀑布、删竞态补偿）。

## 契约

### `GET /api/projects/:projectId/sessions?perPage=10`

```jsonc
{
  "ok": true,
  "sessions": [ /* SessionInfo[]，全项目 active，按 updated_at DESC 归并排序 */ ],
  "byAgent": {
    "<agentId>": { "hasMore": true, "loaded": 10 }
    // 仅列出有 session 或 hasMore 的 agent
  }
}
```

- `perPage` 可选，默认 10，clamp 到 [1, 100]
- `byAgent.loaded`：该 agent 本次返回的条数（前端 offset 起点）
- `SessionInfo` 复用现有 contract，不新增字段

### contracts

`packages/server/src/contracts/` 新增 `projectSessionListResponse`：

```ts
Type.Object({
  ok: Type.Boolean(),
  sessions: Type.Array(schemas.sessionInfo),
  byAgent: Type.Record(
    Type.String(),
    Type.Object({ hasMore: Type.Boolean(), loaded: Type.Integer() }),
  ),
})
```

## 各层实现

### core（`packages/core/src/project-manager.ts`）

```ts
listProjectSessions(perPage: number): {
  sessions: SessionInfo[];
  byAgent: Record<string, { hasMore: boolean; loaded: number }>;
}
```

遍历 `projectStore.agents`，逐 agent 调既有 `SessionStore.listSessionsPage(perPage, 0)`，按 `updatedAt` 归并排序；`byAgent` 仅含 `hasMore || loaded > 0` 的 agent。进程内 N 次 SQLite 读（µs 级），可接受。

### server（`packages/server/src/routes/sessions.ts`）

新增项目级 GET（挂在现有 registerSessionRoutes 内），解析 `perPage` 后调 PM 聚合方法，`parseContract` 校验返回。既有 by-agent 端点不动。

### app

1. `lib/api.ts`：`listProjectSessions(opts?: { perPage?: number })`
2. `queries/project.ts`：
   - `fetchProjectSessionCatalog` 重写为单次 `listProjectSessions`：`sessions` 直接入 cache，`paging` 从 `byAgent` 映射为现有 `SessionPaging` 结构（`{hasMore, offset: loaded, loadingMore: false}`）；generation 重试、requestedOffsets 探测、optimistic 保留逻辑全部删除
   - `useProjectCatalog` 的 sessions 查询不再依赖 `agentsQuery.isSuccess`（`enabled: Boolean(client)`），消掉瀑布
   - `findProjectSession` 回退：由"N 并发 listSessions 找 id"改为单次 `listProjectSessions({ perPage: 100 })` 后本地查找；找不到仍返回 null（404 语义不变）
   - `loadMoreProjectSessions`、`createProjectSession` 等 mutation 的 cache 更新不变（操作同一个 SessionCatalog 结构）
3. `useProjectDataStore` 的 `initialMessageBySessionId` optimistic 保留：迁移后首次加载即全量拿不到（分页截断），保留现有 optimistic filter 语义——fetched 未包含但带 initialMessage 的 session 不丢弃

### 测试

- core：`listProjectSessions` 单测（归并排序、byAgent 游标、perPage clamp 语义、无 session agent 不出现在 byAgent）
- server：契约测试（响应 schema、perPage 默认/边界）
- app：`queries/project.test.ts` 更新——catalog 缓存写入、瀑布消除（sessions 不再等 agents）、load more 不变、项目隔离；`findProjectSession` 回退单次调用断言

## 风险与边界

- **后端聚合成本**：N 次 SQLite 读。agent 数量级为个位数~十几，无风险；若未来上百再考虑合并库
- **跨 agent updatedAt 排序稳定性**：沿用现有 `ORDER BY updated_at DESC, id DESC`，归并时相同 updatedAt 按 id 决胜，与单 agent 语义一致
- **旧端点消费者**：UI SDK（`sessions.list`）、load more、chat runtime 均不受影响
- **refetch 深度保留**（评审补遗，已决策为接受塌缩）：旧实现的 `requestedOffsets` 探测暗中兼任"refetch 保留用户已展开的分页深度"，纯 perPage 替换后重连/agent 变更会把展开过的分组塌缩回 perPage。取舍：**塌缩可接受**——"加载更多"深度视为易失浏览状态，用户重新展开即可；换取 `fetchProjectSessionCatalog` 保持单次调用的简单形态
- **deep-link 覆盖**（评审补遗）：回退先查批量前 100 条；未命中再逐 agent `getSession` 探测（allSettled，取首个成功），覆盖繁忙 agent 100 条之外的旧会话，与旧全量扇出等覆盖

## Followup（不在本次范围）

- **Trigger 项目级批量接口**：`TriggerManager.readAllTriggers()` 已跨 agent 归并，加 `listProject()` 顺风；`TriggerEventBridge` 预载扇出与 `hasEnabledTriggersByAgent` 投影可一次消掉。**前置条件**：先把 `useTriggerStore`（feature-local Zustand）迁入 TanStack Query（triggers key + bridge + `trigger_updated` 事件→invalidate），否则批量接口只是给扇出换了个调用点。与本次 sessions 接口独立，不共享响应模型（sessions 是归并列表+游标，triggers 是 byAgent 映射），不合端点
