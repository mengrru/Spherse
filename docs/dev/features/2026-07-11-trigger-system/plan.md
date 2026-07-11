# Trigger System — Implementation Plan

## Phase 1: Core Layer

### 1.1 类型定义
- `packages/core/src/types.ts`
  - 新增 `TriggerType = "time" | "event"`
  - `ScheduleEntry` → `TriggerEntry`（增加 `type`、`cron?`、`eventName?`）
  - `ScheduleLogEntry` → `TriggerLogEntry`（`scheduleId` → `triggerId`，增加 `eventName?`）
  - 删除 `AgentProfile.schedule` 字段
  - `SessionInfo.source`：`"scheduled"` → `"triggered"`

### 1.2 TimerService
- 新建 `packages/core/src/trigger/timer-service.ts`
- 构造函数注入 `onTick: () => void` 回调（不依赖 EventBus）
- 10 分钟轮询，对齐边界，`timer.unref()`
- 新建 `packages/core/src/trigger/__tests__/timer-service.test.ts`（fake timers）

### 1.3 模板解析
- 新建 `packages/core/src/trigger/template.ts`
- 从 `scheduler.ts` 提取 `resolveTemplateVars`，改为接收 `TemplateContext`
- `payload` 为 `string` 类型，`{{payload}}` 直接字符串替换
- 保留 `{{date}}` / `{{time}}` / `{{datetime}}` / `{{weekday}}` / `{{agent_name}}`
- 不支持 `{{payload.path}}` dot-path（payload 是 string）
- 新建 `packages/core/src/trigger/__tests__/template.test.ts`（从 `scheduler-template.test.ts` 迁移 + 新增 payload 用例）

### 1.4 TriggerStore
- 新建 `packages/core/src/store/trigger.ts`（从 `store/schedule.ts` 改造）
- 目录 `schedules/` → `triggers/`（不做迁移，项目未上线）
- 新建 `packages/core/src/__tests__/store/trigger.test.ts`（从 `schedule.test.ts` 迁移）

### 1.5 TriggerManager
- 新建 `packages/core/src/trigger/trigger-manager.ts`
- 继承 `EventEmitter`（trigger 生命周期事件）
- **不在内存维护 trigger 注册表**——每次事件到达时直接读盘遍历所有 agent 的 `triggers/index.yml`
- 内存状态仅：`inProgress: Set<string>` + `triggerState: Map<string, { cron, nextFire }>`（lazy-built）
- 入口方法：
  - `onTimeTick()`：读盘 → 匹配 time trigger → 检查 cron due → fire
  - `onUserEvent(eventName, payload)`：读盘 → 匹配 event trigger → fire
- CRUD 方法委托 TriggerStore（不在内存缓存）：
  - `list` / `get` / `create` / `update` / `delete` / `deleteAllForAgent` / `getNextTrigger` / `getRecentLogs` / `runNow` / `stopAll`
- `update()` 清除 `triggerState` 中该 ID 的缓存（让下次 tick 重建）
- `fire(entry, agentId, agentName, payload, eventName?)`：createSession/restoreSession + resolveTemplateVars + sendMessage + emit lifecycle events
- 新建 `packages/core/src/trigger/__tests__/trigger-manager.test.ts`（从 `scheduler.test.ts` 迁移 + event trigger 用例）

### 1.6 AgentStore
- `packages/core/src/store/agent-store.ts`：`get schedules()` → `get triggers(): TriggerStore`

### 1.7 Session source
- `packages/core/src/types.ts`：`SessionInfo.source` 值 `"scheduled"` → `"triggered"`

### 1.8 接线
- `packages/core/src/factory.ts`：创建 TriggerManager + TimerService（注入 `() => triggerManager.onTimeTick()` 回调），`timerService.start()`
- `packages/core/src/project-runtime.ts`：字段 `scheduler` → `triggerManager` + `timerService`
- `packages/core/src/index.ts`：barrel 更新（`TriggerManager`、`TriggerEventPayload`、`TimerService`）

### 1.9 删除旧文件
- 删除 `packages/core/src/scheduler.ts`
- 删除 `packages/core/src/store/schedule.ts`
- 删除旧测试文件

### 1.10 验证
```bash
npm run build --workspace=packages/core
npm test --workspace=packages/core
npm run lint --workspace=packages/core
```

---

## Phase 2: Server Layer

### 2.1 Contracts
- 新建 `packages/server/src/contracts/trigger.ts`（从 `schedules.ts` 改造）
  - `triggerEntry`（含 `type` / `cron?` / `eventName?`）
  - `triggerInfoEntry`、`triggerCreateRequest`、`triggerUpdateRequest`
  - `triggerLogEntry`（`triggerId`）
- 删除 `packages/server/src/contracts/schedules.ts`
- 更新 `packages/server/src/contracts/bus.ts`
  - channel `"schedule"` → `"trigger"`
  - event 前缀 `schedule_` → `trigger_`
  - `triggerUpdatedPayload.trigger` 用 `triggerEntry` 替代 `Type.Unknown()`
  - 新增 `emit-trigger-event` client message（`{kind:"emit-trigger-event", projectId, eventName, payload?: string}`）
  - `busClientChannel`：`"trigger"` 替代 `"schedule"`
- 更新 `packages/server/src/contracts/index.ts`：re-export 重命名

### 2.2 Routes
- 新建 `packages/server/src/routes/trigger.ts`（从 `schedules.ts` 改造）
  - endpoint `schedules` → `triggers`、`schedule-logs` → `trigger-logs`
  - `triggerNow` → `runNow`，endpoint `/trigger` → `/run`
  - create/update 校验：type-specific（cron for time, eventName for event, sp: 前缀拒绝）
  - `req.projectCtx!.scheduler` → `req.projectCtx!.triggerManager`
- 删除 `packages/server/src/routes/schedules.ts`
- 更新 `packages/server/src/routes/index.ts`：`registerScheduleRoutes` → `registerTriggerRoutes`

### 2.3 ws-bus
- 更新 `packages/server/src/ws-bus.ts`
  - `EVENT_TYPES` → `TRIGGER_EVENT_TYPES`（`trigger_` 前缀）
  - `ScheduleHandle` → `TriggerHandle`
  - `buildSchedulePayload` → `buildTriggerPayload`
  - subscribe `"trigger"` channel：listener 挂到 `ctx.triggerManager`
  - `onMessage` 新增 `case "emit-trigger-event"`：调用 `ctx.triggerManager.onUserEvent(eventName, payload ?? "")`

### 2.4 Registry
- 更新 `packages/server/src/registry.ts`
  - `ProjectContext`：`scheduler` → `triggerManager`（无 EventBus）
  - import 更新

### 2.5 验证
```bash
npm run build --workspace=packages/server
npm test --workspace=packages/server
npm run lint --workspace=packages/server
```

---

## Phase 3: Frontend Layer

### 3.1 目录迁移
- `features/agent-schedule/` → `features/agent-trigger/`（git mv）
- 所有文件重命名（见 design.md §4.1 表格）

### 3.2 Store
- `features/agent-trigger/store.ts`：全面重命名
  - `useScheduleStore` → `useTriggerStore`
  - `schedulesByAgent` → `triggersByAgent`、`runningScheduleIdsByAgent` → `runningTriggerIdsByAgent`
  - `refreshSchedules` → `refreshTriggers`、`createSchedule` → `createTrigger` 等
  - `handleScheduleEvent` → `handleTriggerEvent`
  - `setHasEnabledSchedules` → `setHasEnabledTriggers`

### 3.3 Types + API client
- `lib/types.ts`：re-export 重命名（`TriggerEntry` / `TriggerInfo` / `TriggerLogEntry` / `TriggerServerEvent`）
- `lib/api.ts`：方法 + endpoint 重命名

### 3.4 Form
- `TriggerForm.tsx`：
  - 新增触发类型选择器（time / event）
  - type === "time"：显示 cron + presets + granularityHint
  - type === "event"：显示 eventName input + eventHint
  - 变量按钮按 type 动态显示（event 显示 `{{payload}}`，time 显示 `{{date}}` 等）
- `trigger-form-reducer.ts`：新增 `type` / `eventName` 字段

### 3.5 List / Logs
- `TriggerList.tsx`：显示 type 标签；time 显示 nextTriggerAt，event 显示 eventName
- `TriggerLogs.tsx`：字段重命名

### 3.6 EventBridge
- `TriggerEventBridge.tsx`：channel `"trigger"`，事件类型 `trigger_*`
- 预加载 `client.listTriggers`

### 3.7 bus-store
- `stores/bus-store.ts`：`BusChannel` `"schedule"` → `"trigger"`
- 新增 `emitAgentTriggerEvent(projectId, eventName, payload?: string)` 方法（payload 为 string）

### 3.8 UI SDK
- 新建 `ui-sdk/handlers/emit-agent-trigger-event.ts`：`registerAction("emitAgentTriggerEvent", ...)`（payload 为 string）
- 更新 `ui-sdk/handlers/data.ts`：导入 emit-trigger-event handler
- 更新 `ui-sdk/types.ts`（如有 action name union）

### 3.9 project-data-store
- `stores/project-data-store.ts`：`hasEnabledSchedulesByAgent` → `hasEnabledTriggersByAgent`，`setHasEnabledSchedules` → `setHasEnabledTriggers`

### 3.10 AgentRow / Dialogs / Layout
- `features/agent-session-list/AgentRow.tsx`：指示器 key + 菜单项 i18n key
- `features/agent-session-list/AgentSessionDialogs.tsx`：dialog state kind `"trigger"` + 组件引用
- `layouts/ProjectScope.tsx`：`TriggerEventBridge` 引用

### 3.11 测试
- 更新 `store.test.ts`
- 更新 `TriggerFeature.structure.test.tsx`
- 更新 bus-store / ui-sdk 相关测试

### 3.12 验证
```bash
npm run build --workspace=packages/app
npm test --workspace=packages/app
npm run lint --workspace=packages/app
```

---

## Phase 4: i18n

### 4.1 zh-CN（基准）
- 重命名 34 个 `agent-schedule.*` → `agent-trigger.*`
- 新增 8 个 key（type / typeTime / typeEvent / eventName / eventNamePlaceholder / eventHint / eventNameReserved / payloadVarHint）
- 文案调整（dialogTitle / menuItem / createTrigger / noTriggers / confirmDelete / indicatorTooltip / notificationDefault）
- 每条 key 补注释说明 UI 上下文

### 4.2 zh-TW + en
- 同步重命名 + 新增 + 翻译

### 4.3 验证
```bash
npm test --workspace=packages/i18n
npm run i18n:check  # 或 verify 中的 i18n 检查
```

---

## Phase 5: 最终验证

```bash
npm run build               # 全量编译
npm run lint                # 全量 lint
npm test --workspace=packages/core
npm test --workspace=packages/server
npm test --workspace=packages/i18n
npm test --workspace=packages/app
```

可选 E2E（如影响范围涉及 agent-session-list / chat）：
```bash
npm run test:e2e --workspace=packages/app -- e2e/agent-session-list.spec.ts
```

---

## Phase 6: 文档更新

### 6.1 backlog.md
- 新增 backlog 条目：触发器系统（event trigger + 全量重命名 + disk-based scan）
- 标记 `[x]` 完成

### 6.2 docs/official
- 检查 `docs/official/project-structure.md` 是否提及 schedules 目录，更新为 triggers
- 检查是否有其它 official 文档引用 scheduler

---

## 执行顺序与依赖

```
Phase 1 (Core) ──────► Phase 2 (Server) ──────► Phase 3 (Frontend)
                                                         │
                                                         ▼
                                               Phase 4 (i18n)
                                                         │
                                                         ▼
                                               Phase 5 (验证)
                                                         │
                                                         ▼
                                               Phase 6 (文档)
```

Phase 1-2 必须先于 Phase 3（前端依赖 server contracts + core types）。Phase 4 可与 Phase 3 并行（i18n key 不阻塞编译，但前端引用 key 需 Phase 4 先完成 key 定义）。

## 风险与注意事项

1. **ws-bus 向后兼容**：`/ws/bus` 的 client message 新增 `emit-trigger-event` kind。channel 名从 `"schedule"` → `"trigger"` 是破坏性变更，但项目未上线无跨版本兼容问题。
2. **磁盘读取性能**：每次 `onTimeTick` / `onUserEvent` 读盘遍历所有 agent。典型场景（~10 agents × ~5 triggers）每 10 分钟 10 次小文件读，开销可忽略。如未来 agent 数量或事件频率显著增长，可引入带磁盘变更检测的内存缓存。
3. **eventName 校验一致性**：`sp:` 前缀拒绝需在三层校验（route create/update + ws-bus `onUserEvent` 内部 + 前端 form），防御性编程。
4. **triggerState lazy-built**：`triggerState` 在每次 `onTimeTick` 时从磁盘内容 lazy 重建（新 trigger 或 cron 变更时重新计算 nextFire），`update()` 主动清除缓存。`onUserEvent` 不使用 `triggerState`（event trigger 无需 cron 计算）。
