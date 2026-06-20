# Agent Item 定时消息标记 Icon

## Background

定时运行（scheduled execution）feature 已上线，用户可以为 agent 配置多条定时任务。但在 agent session 列表里，用户无法一眼看出哪个 agent 开启了定时消息——必须逐个打开 agent 的下拉菜单 → 点击「定时消息」打开 dialog 才能确认。当项目里有多个 agent 时，这严重影响了「定时任务总览」心智模型的建立。

本 feature 在 `AgentRow`（agent 列表项）上增加一个常驻 icon，标记「该 agent 至少有一条 **enabled** 的 schedule」，让用户在列表层就能识别。

## Goal

- 任意开启了定时消息的 agent，在 `AgentRow` 上显示一个常驻的 `Clock` icon
- icon 仅作为视觉标记，不影响点击行为（点击仍展开/折叠该 agent 的 session 列表）
- 鼠标 hover 时显示原生 tooltip 说明含义
- 以下场景下 icon 状态实时更新，无需手动刷新：
  - 项目首次打开时根据现有 schedules 计算
  - 用户通过 schedule dialog 新建/启用/禁用/删除 schedule 后

## Non-Goal

- 不修改 schedule 的数据模型、CRUD 逻辑、调度引擎
- 不为 icon 增加点击行为（点击 icon 等同于点击该行——展开/折叠 session 列表）。后续若需要「点击 icon 直达 schedule dialog」可另起 feature
- 不在 icon 上展示 schedule 数量/下次触发时间等详情（这些信息保留在 dialog 内）
- 不引入批量 schedules 接口（N 个 agent 走 N 次 per-agent 请求）；如未来出现性能问题，可作为独立的非破坏性 follow-up

## Constraints

- 遵循 AGENTS.md 的 store 边界约定：feature-local store（`agent-schedule/store.ts`）不可被其它 feature import。`AgentRow` 位于 `agent-session-list` feature，因此 icon 所需的派生状态必须放在可跨 feature 消费的全局 store（`project-data-store`）
- 复用现有图标库 `lucide-react`，复用现有 per-agent schedules 接口 `GET /api/.../agents/:agentId/schedules`
- i18n 以 `packages/i18n/src/locales/zh-CN.ts` 为基准，必须同步更新 `zh-TW.ts` 与 `en.ts`

## Design

### 1. 语义定义

| 状态 | icon 表现 |
|------|-----------|
| agent 无 schedule，或全部 schedule `enabled === false` | 不显示 icon |
| agent 有 ≥1 条 `enabled === true` 的 schedule | 显示 `Clock` icon（常驻，非 hover 触发） |
| agent 有 schedule 但全部禁用 | 不显示 icon |

「正在运行」（`runningScheduleIds`）不参与判定——icon 表达的是「配置上的开关状态」，而非「此刻是否在执行」。运行态信息保留在 dialog 与日志中。

### 2. 数据来源与架构

#### 2.1 为什么不复用 `AgentProfile.schedule`

`AgentProfile.schedule?: boolean` 字段（`packages/core/src/types.ts:23`）从类型层面存在，且 `docs/official/data-conventions.md:68` 与 `2026-06-11-agent-scheduled-execution/design.md` 的「Profile frontmatter 变更」章节都规划过它用于「快速筛选」。

但现状下该字段**未被 schedule CRUD 维护**：

- `scheduler.register/unregister`（`packages/core/src/scheduler.ts:114-143`）只写 `schedules.yml`，从不回写 `profile.md` frontmatter
- POST/DELETE schedule 路由（`packages/server/src/routes/schedules.ts`）同样不触碰 profile
- 全仓搜索没有任何写入 `schedule: true/false` 到 profile 的代码路径

也就是说，今天 `agent.schedule` 只有在用户手工编辑 `profile.md` 时才可能为 `true`，**对 UI 不可靠**。

同时，布尔字段无法表达「至少一条 enabled」语义（它只能表达「有/无 schedule」），与本 feature 的 icon 语义不匹配。

因此本 feature **不依赖、也不维护** `AgentProfile.schedule` 字段。

#### 2.2 为什么不直接读 `useScheduleStore`

`useScheduleStore`（`packages/app/src/features/agent-schedule/store.ts`）持有完整的 `schedulesByAgent` 映射，语义最准确。但它是 feature-local store，按 AGENTS.md 的强约束：

> feature-local store 不应被其它 feature 或全局 store import

`AgentRow` 位于 `agent-session-list` feature，不能直接订阅 `useScheduleStore`。

#### 2.3 选定方案：在全局 `project-data-store` 派生轻量信号

`project-data-store` 现有结构是按 projectId 聚合的：`state.projects[projectId].agents`、`.sessions` 等。本 feature 沿用同一层级，在该 project 的数据块下新增一个仅含布尔的派生字段：

```ts
interface ProjectData {
  // ...existing (agents, sessions, ...)
  hasEnabledSchedulesByAgent: Record<string /* agentId */, boolean>;
}
```

嵌在 `projects[projectId]` 下的好处：现有的 `clearProject(projectId)` action 天然连同该字段一起清空，无需新增独立的 clear action（见 §5）。

**只存布尔值，不复制 schedule 详情**——完整的 schedule 列表（含 cron、message、logs 等）仍由 `useScheduleStore` 独占。两者职责清晰互不重叠：

| Store | 数据 | 消费者 |
|-------|------|--------|
| `useScheduleStore`（feature-local） | 完整 schedule 列表、运行态、日志 | `ScheduleDialog` 及其子组件 |
| `project-data-store.hasEnabledSchedulesByAgent` | 仅「是否有 enabled schedule」布尔 | `AgentRow`（以及未来其它需要快速识别的 UI） |

#### 2.4 预加载流程

`ProjectScope`（`packages/app/src/pages/ProjectScope.tsx`）当前在项目打开时已经 `refreshAgents` + `refreshSessions` + 订阅 schedule WebSocket。在 `refreshAgents` 完成后追加一步：

```ts
// 伪代码，位于 ProjectScope 的 effect 中
const agents = await refreshAgents(...);
await Promise.allSettled(
  agents.map((agent) =>
    client.listSchedules(projectId, agent.id).then((schedules) => {
      const has = schedules.some((s) => s.enabled);
      setHasEnabledSchedules(projectId, agent.id, has);
    })
  )
);
```

- 复用现有 `ApiClient.listSchedules`（`packages/app/src/lib/api.ts`）与现有 `GET /agents/:agentId/schedules` route，**零后端改动**
- `Promise.allSettled` 并发拉取（见 §6 错误处理），单个 agent 失败不阻塞其它
- 该 effect 依赖 `project.ctx.client` 与 `projectId`（稳定引用），符合 AGENTS.md 的 effect 依赖规范

#### 2.5 实时更新：经过 CRUD chokepoint 同步（不是 WS）

**关键事实（来自代码核查）：** Scheduler 的事件模型只覆盖运行态，不覆盖 CRUD：

| Scheduler 方法 | 是否 emit 事件 | 事件类型 |
|----------------|----------------|----------|
| `register`（创建）| ❌ 不 emit | — |
| `unregister`（删除）| ❌ 不 emit | — |
| `update`（编辑/启停）| ✅ emit | `schedule_updated` |
| `tick`（cron 触发）| ✅ emit | `schedule_triggered` / `_completed` / `_failed` |

也就是说，**创建/删除 schedule 不会产生任何 WebSocket 事件**。现有的 `useScheduleStore.handleScheduleEvent`（`store.ts:123-148`）也只处理 `schedule_triggered/completed/failed/updated` 四种运行态事件，不处理 CRUD。

因此依赖 WS 让 icon 实时更新是**不可行**的——创建/删除会漏。现有 dialog 自身的 CRUD 同步走的是另一条路：每个 CRUD action（`createSchedule`/`updateSchedule`/`deleteSchedule`，`store.ts:85-110`）在 await 完 REST 调用后都显式调一次 `refreshSchedules`，重新拉取该 agent 的完整列表写入 feature-local store。这是 dialog 内部保持准确的真正机制。

**本 feature 复用同一个 chokepoint：** 让 `useScheduleStore.refreshSchedules` 在写完自己的 `schedulesByAgent` 后，**同时**把派生布尔推到全局 `project-data-store`。由于 create/update/delete 三个 action 全都走 `refreshSchedules`，这一处注入即覆盖全部 CRUD 路径：

```
用户在 dialog 里 CRUD
  → useScheduleStore.create/update/deleteSchedule
  → REST 调用成功
  → refreshSchedules(projectId, client, agentId)   ← 已有
       → client.listSchedules(agentId)
       → 写 useScheduleStore.schedulesByAgent      ← 已有
       → 【新增】写 project-data-store.hasEnabledSchedules  ← 本 feature 注入点
```

**边界合法性：** feature-local store 调用全局 store 的公开 action 不违反 AGENTS.md 的约束。该约束是「全局 store 不应**依赖（import/read）** feature-local store」——反向（feature-local 写入全局）是标准消费模式，与任何 feature 调用 `useProjectDataStore.getState().setXxx()` 等价。

**WS 作为防御性次要路径：** `schedule_updated` 事件（仅 `update` 路径产生）仍可在 `ProjectScope` 的 WS handler 里额外触发一次重算，用于多窗口/外部修改场景下的最终一致。但因为 CRUD chokepoint 已经覆盖单窗口主路径，WS 重算仅作保险，不是主机制。运行态事件（`schedule_triggered/completed/failed`）与 icon 无关，不处理。

### 3. UI 变更

#### 3.1 `AgentRow` 改动

文件：`packages/app/src/features/agent-session-list/AgentRow.tsx`

当前 `TreeRow` 内只有 `ChevronRightIcon` + agent name 文本，右侧 `pr-8` 预留给 hover 才显示的 `MoreHorizontalIcon` 菜单按钮。

改动：在 name span 之后、`MoreHorizontalIcon` 之前插入条件渲染的 `Clock` icon：

```tsx
<TreeRow depth={0} selected={active} onClick={...} className="pr-8">
  <ChevronRightIcon className={...} />
  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{agent.name}</span>
  {hasEnabled && (
    <Clock
      className="ml-auto h-3 w-3 shrink-0 text-muted-foreground"
      aria-label={t("agent-schedule.indicatorTooltip")}
    />
  )}
  <DropdownMenu>...<MoreHorizontalIcon />...</DropdownMenu>
</TreeRow>
```

要点：

- **复用 `SessionRow` 流式 spinner 的模式**（`SessionRow.tsx:162-173`）：`ml-auto` 推到右侧、`h-3 w-3 shrink-0`、`text-muted-foreground`
- **常驻显示，非 hover 触发**——icon 的目的是「一眼识别」，不应被 hover 行为遮蔽
- **位置在 `MoreHorizontalIcon` 左侧**：`ml-auto` 把 icon 推到行内容右侧，而 `MoreHorizontalIcon` 是 `absolute right-1` 定位的 hover 按钮，二者不冲突（icon 占据 `pr-8` 预留区左侧）
- **非交互**：icon 上不加 `onClick`、不阻止冒泡，点击 icon 等同点击该行（展开/折叠 session 列表），与 row 其余非按钮区域一致
- **`hasEnabled` 来源**：`const hasEnabled = useProjectDataStore((s) => s.projects[projectId]?.hasEnabledSchedulesByAgent?.[agent.id] ?? false)`

#### 3.2 Icon 选择

`Clock`（lucide-react）：通用、表意清晰（定时 / 周期）。备选 `CalendarClock` 更强调「日历 + 时间」，但「定时消息」概念更接近「周期触发」而非「某个日历时刻」，`Clock` 更合适。

颜色走 `text-muted-foreground`——它是「状态标记」而非需要强调的 CTA，与 `SessionRow` 流式 spinner 的处理一致。

#### 3.3 Tooltip

使用原生 `title` 属性（而非 shadcn `Tooltip` 组件），原因：

- `agent-session-list` feature 内**已有先例**用 `title=`（`index.tsx:176` 的 `SidebarGroupAction`），保持局部一致
- shadcn `Tooltip` 需要 `TooltipProvider` 包裹与额外 DOM 层，对一个 16px 装饰 icon 过重

实现：在 `Clock` 上加 `title={t("agent-schedule.indicatorTooltip")}`，并同步设置 `aria-label` 供屏幕阅读器访问。

### 4. i18n

在 `packages/i18n/src/locales/zh-CN.ts` 的 `agent-schedule.*` 命名空间下新增一条：

```ts
// zh-CN.ts
indicatorTooltip: "已开启定时消息", // Agent 列表项上的 Clock icon tooltip：该 agent 至少有一条 enabled 的 schedule，hover icon 时显示
```

同步翻译到：

```ts
// zh-TW.ts
indicatorTooltip: "已開啟定時訊息",

// en.ts
indicatorTooltip: "Scheduled messages enabled",
```

`zh-CN.ts` 的注释需按 AGENTS.md 规范写清「出现位置 + 上下文 + 交互」，指导其它语言翻译。

### 5. Store 接口

`project-data-store` 新增 action：

```ts
interface ProjectDataActions {
  // ...existing
  setHasEnabledSchedules: (projectId: string, agentId: string, has: boolean) => void;
}
```

- `setHasEnabledSchedules` 有三个调用点：(1) `ProjectScope` preload 流程，(2) `useScheduleStore.refreshSchedules`（CRUD chokepoint，主路径），(3) 可选的 WS `schedule_updated` handler（防御性次要路径）
- **不需要单独的 `clearHasEnabledSchedules` action**：字段嵌在 `projects[projectId]` 下（§2.3），现有的 `clearProject(projectId)`（关闭项目时由 `App.tsx` 调用）会连同 agents/sessions 一起清空，符合 AGENTS.md「per-project 状态的清理」约定

### 6. 边界与错误处理

- **拉取 schedules 失败**：preload 单个 agent 失败不应阻塞其它 agent。preload 用 `Promise.allSettled`（§2.4），失败的 agent 视为 `has = false`（即不显示 icon），并 `console.warn` 记录。用户随后打开 dialog 仍会触发 `useScheduleStore.refreshSchedules`，能拿到真实错误
- **WS `schedule_updated` 早于或晚于 CRUD 同步**：WS 是防御性次要路径（§2.5），主同步由 CRUD chokepoint 完成。即便 WS 与 chokepoint 时序交错，二者都从 server 拉真实数据重算，最终态一致
- **CRUD 失败**：`useScheduleStore` 的 create/update/delete 已用 try/catch 静默吞错（`store.ts:89-91` 等），失败时不会调用后续 `refreshSchedules`，因此 `hasEnabledSchedulesByAgent` 维持旧值——这与 dialog 不更新自身列表的行为一致，不会出现「icon 显示已开但实际没有」的假阳性
- **项目无 agent / 全部无 schedule**：store 字段为空对象 `{}`，selector 返回 `false`，无 icon 渲染
- **agent 被删除**：`refreshAgents` 会更新 agent 列表，被删 agent 的 row 不再渲染；其 `hasEnabledSchedulesByAgent[id]` 残留无副作用（不会被任何 row 读到），下次 `clearProject` 时清空

## Testing

### 单元测试

1. **`project-data-store` 测试**（`packages/app/src/stores/__tests__/`）：
   - `setHasEnabledSchedules` 写入后 selector 能正确读出
   - `clearProject(projectId)` 连同 `hasEnabledSchedulesByAgent` 一起清空（无需独立 clear action）
   - 不同 project 之间数据隔离

2. **`AgentRow` 结构测试**（`packages/app/src/features/agent-session-list/__tests__/AgentRow.structure.test.ts`，沿用现有源码字符串断言风格）：
   - `hasEnabled === true` 时源码中包含 `Clock` import 与条件渲染
   - `hasEnabled === false` 时不渲染 icon（断言 `ml-auto` icon 块不存在）

3. **CRUD chokepoint 同步测试**（`packages/app/src/features/agent-schedule/__tests__/`）：
   - mock `client.listSchedules` 返回 `[{enabled:true},{enabled:false}]` → 调用 `refreshSchedules` 后 `project-data-store.hasEnabledSchedulesByAgent[agentId]` 为 `true`
   - mock 返回 `[{enabled:false}]` → 为 `false`
   - 验证 `createSchedule`/`updateSchedule`/`deleteSchedule` 三个 action 成功后均触发 `project-data-store` 的同步（即都经过 `refreshSchedules` chokepoint）

4. **`ProjectScope` preload 测试**：
   - 多个 agent 并发拉取，其中一个 reject 时不影响其它 agent 的布尔写入（`Promise.allSettled` 行为）

### 手动验证

- 创建 agent A，加一条 enabled schedule → A 行出现 Clock icon
- 把该 schedule 改为 disabled → icon 消失
- 再加一条 enabled schedule → icon 重新出现
- 删除所有 schedule → icon 消失
- 重启 app / 重新打开项目 → icon 状态与配置一致
- hover icon → tooltip 文案正确（中/英切换）

### Lint / 类型 / i18n 校验

提交前跑：

```bash
npm run verify              # lint + build + unit tests + i18n check
```

确保 i18n key 在三个 locale 文件中齐备，类型与 ESLint 通过。

## Out of Scope（明确不做）

- 批量 schedules 接口（`GET /schedules?all=true`）——非破坏性 follow-up，等性能问题出现再做
- 「点击 icon 打开 schedule dialog」——需要破坏 row 现有展开/折叠语义，另起 feature 讨论
- 在 icon 旁显示 schedule 数量徽标——超出「标记」范畴，详情保留在 dialog
- 修复 `AgentProfile.schedule` 字段的回写——超出本 feature，且与本 feature 的 enabled 语义不匹配；如未来要修复，应作为 schedule feature 的独立加固任务
