# Trigger 查询迁移 + 项目级批量接口设计

- 日期：2026-08-26
- 状态：已实施
- 前置阅读：`docs/dev/features/2026-08-26-project-sessions-batch-api/design.md` followup 节（本设计是其落地）

## 背景与问题

Trigger 前端数据面有三块，现状与问题：

1. **triggers 真相（服务端磁盘，per-agent `triggers/index.yml`）住在 feature-local Zustand**（`useTriggerStore.triggersByAgent`）——违反 app README 的"服务端状态归 Query"边界；CRUD actions（create/update/delete/run/resetBinding/refreshTriggers）各自手动调 API + 手动重拉
2. **预载扇出**：`TriggerEventBridge` 挂载时等 agents 查询成功 → `Promise.allSettled` N 并发 `listTriggers` → 写 `project-data-store.hasEnabledTriggersByAgent` 投影（trigger 域越界写全局 store）——与 sessions 批量接口消掉的扇出同构
3. **`hasEnabledTriggers` 指示器**（AgentRow 的时钟 icon）依赖上述投影，agents 数量增长时预载请求线性增长

另外：trigger 弹窗每次打开强制 `refreshTriggers` 重拉（无缓存）；trigger 事件（`trigger_updated` 等）到达时逐 agent 重拉。

## 决策

| 决策点 | 结论 |
|---|---|
| 批量接口 | 新增 `GET /api/projects/:projectId/triggers`，归并返回全项目 triggers（含 `agentId`、`nextTriggerAt`） |
| 响应模型 | 归并扁平列表（非 byAgent 映射）——UI 弹窗按 agent 过滤、指示器按 agent 派生，select 过滤比嵌套更顺；trigger 数据量小（每 agent 个位数）无分页 |
| 聚合位置 | `TriggerManager.listProject()`（复用 `readAllTriggers()` + 逐条 `getNextTrigger`），server 薄路由 |
| store 去留 | **瘦身不删除**：running 运行态（`runningTriggerIdsByAgent`）与 `triggerEventVersion`（logs 重拉信号）是事件驱动瞬时状态、无服务端查询端点，留在 feature-local store 是正确用法；删 `triggersByAgent` + 全部 CRUD actions + `refreshTriggers` |
| 投影 | 删 `project-data-store.hasEnabledTriggersByAgent`；指示器改由 query select 派生 |
| 失效语义 | `staleTime: Infinity`（继承全局）；失效仅四类——本窗口 mutation（facade 写后 invalidate）、trigger channel 事件（bridge invalidate）、bus 重连补偿、项目关闭 `removeQueries(all)` |
| 旧端点 | 全保留（弹窗 mutation 走 by-agent CRUD、logs、`manage_trigger` 工具路径） |

### 行为差异（相对现状，接受）

- 弹窗打开不再强制重拉：新鲜度由 mutation invalidate + 事件 invalidate 全覆盖（本窗口写、agent 经 `manage_trigger` 工具写、trigger 执行变更状态，三者都有失效路径），无失去新鲜的窗口
- trigger 事件到达不再逐 agent 重拉：失效整个 triggers 查询，单次批量重拉

## 契约

### `GET /api/projects/:projectId/triggers`

```jsonc
{
  "ok": true,
  "triggers": [ /* TriggerInfo[]，归并列表 */ ]
}
```

`TriggerInfo` = 现有 `triggerInfoEntry`（含 `nextTriggerAt: number | null`）+ `agentId: string`，新独立 contract `projectTriggerListResponse`，不改旧 schema。

## 各层实现

### core（`trigger/trigger-manager.ts`）

```ts
listProject(): { agentId: string; info: TriggerInfo }[]
```

遍历 `readAllTriggers()`，逐条附 `getNextTrigger(agentId, entry.id)?.getTime() ?? null`。server 路由已有逐条计算 nextTriggerAt 的逻辑（routes/trigger.ts:23），聚合方法吸收之。

### server（`routes/trigger.ts`）

新增项目级 GET，调 `triggerManager.listProject()`，映射为归并 info 列表 + `parseContract`。旧 by-agent 端点不动。

### app

1. `lib/api.ts` + types：`listProjectTriggers(): Promise<ProjectTriggerListResponse>`
2. `queries/keys.ts`：`triggers: (projectId) => ["projects", projectId, "triggers"]`
3. 新 `queries/triggers.ts`：
   - `useProjectTriggers(projectId, client)` — 批量查询
   - `useAgentTriggers(projectId, client, agentId)` — select 按 agentId 过滤（弹窗用）
   - `useAgentHasEnabledTrigger(projectId, client, agentId)` — select 派生 boolean（AgentRow 指示器）
   - `invalidateProjectTriggers(projectId)` facade
   - `createAgentTrigger` / `updateAgentTrigger` / `deleteAgentTrigger` / `runAgentTrigger` / `resetAgentTriggerBinding` — 调 client + 写后 invalidate（run/reset 照旧端点）
4. `features/agent-trigger/store.ts` 瘦身：仅剩 `runningTriggerIdsByAgent`、`triggerEventVersion`、`handleTriggerEvent`（running 增删 + completed → `refreshProjectSessions` + 通知）、`clearProject`；通知补拉的缓存 miss 回退改读 query cache（`queryClient.getQueryData`）
5. 新 `features/agent-trigger/TriggerEventBridge`（挂 ProjectScope，实施时与原设想的独立 TriggerQueryBridge 合并——该域带运行态，单一事件接线优于"纯失效 bridge + 运行态 bridge"双订阅）：bus trigger channel `updated`/`completed`/`failed` → invalidate + running 增删 + completed 通知/refreshHistory（`triggered` 为纯运行态事件，不失效）；`useReconnectedSync` → invalidate + 清空 running 标记。原有预载 effect 删除
6. `features/agent-trigger/index.tsx`：弹窗改 `useAgentTriggers`；CRUD handler 改调 query facade；删 `open` 时的 `refreshTriggers` effect
7. `stores/project-data-store.ts`：删 `hasEnabledTriggersByAgent` + `setHasEnabledTriggers`；`features/agent-session-list/AgentRow.tsx` 改 `useAgentHasEnabledTrigger`
8. `activity-bar/use-project-actions.ts`：`clearTriggerData` 保留（running 态仍需清理）

### 测试

- core：`listProject` 归并与 nextTriggerAt 映射单测
- server：契约测试（schema、归并响应）
- app：`queries/triggers.test.ts`（缓存复用、mutation invalidate、select 派生、projectId 隔离）；`store.test.ts` 瘦身更新（running 增删、completed→refreshProjectSessions）；`TriggerQueryBridge` 照 ThemeQueryBridge 测试模式；`project-data-store.test.ts` 删投影用例；AgentRow 相关结构断言更新

## 风险与边界

- **数据量**：trigger 每 agent 个位数、全项目两位数级，归并全量无分页风险
- **`nextTriggerAt` 时效**：批量接口每次计算 cron 下次触发时间；staleTime Infinity 缓存下指示器不消费该字段（弹窗列表显示它，事件失效会刷新）——cron 精度分钟级，缓存窗口内偏差可忽略
- **弹窗打开零请求**：依赖失效全覆盖。审计过的写路径——本窗口 mutation（facade）、agent `manage_trigger`（emit `trigger_updated` → bridge）、执行器状态变更（`trigger_completed`/`trigger_failed` → bridge）。若未来出现新写路径（如外部直接改 yml 文件），fs-watch 不覆盖 `triggers/index.yml` 变更——记为已知边界，出现真实需求再加 fs-watch 桥接
- **running 态与 triggers 数据分离**：`runTrigger` 的乐观 running 标记留在 store，失败回滚逻辑不变；查询层只管真相数据。重连补偿时清空 running 标记（missed completion 不重放、server 无 running 查询端点可对账；run 本身在 server 侧继续执行）
- **通知缓存 miss**（接受）：completed 通知的 trigger 查找只读 query 缓存，冷启动初始拉取完成前或拉取失败时到达的 completed 通知会被静默丢弃（旧实现此处有一次 API 补拉）；AgentRow 挂载即订阅批量查询，正常路径下缓存总是热的
- **非桌面 host 的指示器**（已知，接受）：`useAgentHasEnabledTrigger` 无 feature gate，web host（trigger flag 关）仍会发 `GET /triggers` 并可能显示时钟 icon；web 壳未实现，出现真实需求时加 gate
