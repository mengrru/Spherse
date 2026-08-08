# Trigger Reusable Session（触发器可复用会话模式）

## Background

触发器（trigger）当前支持两种会话模式（`mode` 字段）：

- `new_session`：每次触发都新建一个会话执行
- `existing_session`：每次触发在用户指定的已有会话（`targetSessionId`）中执行，需配合 `targetSessionId`

用户希望新增一种「复用会话」语义：**首次触发时新建一个会话并绑定，之后每次触发都复用这个被绑定的会话**。这种模式适用于希望保持上下文连续、又不想手动提供会话 ID 的场景。

## Goal

- 新增第三种会话模式 `reusable_session`
- 首次触发新建会话、绑定并落盘；后续触发复用该绑定会话
- 绑定状态对用户可见，支持手动「解除绑定」
- `reusable_session` 作为用户新建 trigger 时的**默认选中**模式
- 同步适配 LLM tool（`manage_trigger`）

## Non-Goals

- 不改变 `new_session` / `existing_session` 的既有语义
- 不改造为 discriminated union 对象结构（保持 `mode` + 扁平可选字段的现状）
- 不做系统级定时任务、不做跨重启内存态（绑定直接落盘）

## Constraints

- `mode` 为扁平字符串联合，`boundSessionId` 为新增的可选字段，仅在 `reusable_session` 下由运行时写入
- `boundSessionId` 不得由 create/update API 或 LLM tool 作为输入设置，只能由 `fire()` 写入或由 reset 动作清空
- 存量 trigger 条目无需迁移：`mode` 联合 widening、`boundSessionId` 可选，前向兼容

## Design

### 1. 数据模型

扩展核心类型与运行时 schema：

```ts
// packages/core/src/types.ts
export interface TriggerEntry {
  // ...既有字段
  mode: "new_session" | "existing_session" | "reusable_session";
  targetSessionId?: string;   // 仅 existing_session 使用（用户意图），语义不变
  boundSessionId?: string;    // 仅 reusable_session 使用（运行时绑定状态）
  // ...
}
```

**字段归属**

| 字段 | 谁写入 | 说明 |
|------|--------|------|
| `targetSessionId` | 用户（existing_session 下填写） | 语义不变 |
| `boundSessionId` | 仅 `fire()` 写入 / reset 动作清空 | 运行时状态，落盘跨重启保留 |

三处 TypeBox schema（`packages/server/src/contracts/trigger.ts`）同步加第三个 literal：
- `triggerEntry`：`mode` 加 `reusable_session`；新增 `boundSessionId: Type.Optional(Type.String())`
- `triggerCreateRequest`：`mode` 加 `reusable_session`；**不含** `boundSessionId`
- `triggerUpdateRequest`：`mode` Optional 加 `reusable_session`；**不含** `boundSessionId`

前端 `TriggerSessionMode` 别名（`trigger-form-helpers.ts`）同步加 `reusable_session`。

### 2. 运行时：`fire()` 重构

将 `packages/core/src/trigger/trigger-manager.ts:243-252` 的 `if (new_session) / else if (targetSessionId) / else error` 链重构为 `switch(entry.mode)`，顺带修复当前按 `targetSessionId` 真值而非 `mode` 分支的 footgun。`new_session` / `existing_session` 分支语义不变。

新增 `reusable_session` 分支：

```ts
case "reusable_session": {
  const bound = entry.boundSessionId;
  if (bound && await this.sessionExists(agentId, bound)) {
    sessionId = bound;
    await this.sessionRuntime.restoreSession(agentId, sessionId);
  } else {
    sessionId = await this.sessionRuntime.createSession(agentId, "triggered");
    await this.store.update(entry.id, { boundSessionId: sessionId });   // 写回 + 落盘
    // 广播 trigger_updated（复用现有 trigger 变更的 emit 机制与签名），让订阅 UI 实时刷新绑定状态
    this.broadcastTriggerUpdate(entry.id);
  }
  break;
}
```

> `broadcastTriggerUpdate` 为占位名，指代「读回更新后的 entry 并按现有 `trigger_updated` 事件签名广播」这一动作；具体复用 TriggerManager 既有的更新广播路径，plan 阶段对齐签名。

**边界处理**

- **绑定会话被删除/不可用**：`sessionExists` 判定为假 → 自动新建并重新绑定（用户无感继续复用）。`sessionExists` 的精确 API 在 plan 阶段确认，优先使用 session store 的显式存在性检查，回退为 `restoreSession` 抛错捕获。
- **重启**：`boundSessionId` 已落盘，继续复用，符合「一直复用」。
- **created session 的 source**：沿用 `"triggered"`（与 `new_session` 一致）。

### 3. 并发保护

首次触发可能并发（manual `runNow` + time-tick，或多个 user event 同时命中），两个 fire 都看到 `boundSessionId` 为空 → 各建一个会话、写回时后者覆盖、孤儿一个。

实现：复用 `TriggerManager` 既有的 `inProgress: Set<string>` 守卫——`onTimeTick` / `onUserEvent` / `runNow` 三个入口在调用 `fire()` 前都先 `inProgress.add(triggerId)`，并在 `.finally()` 中移除，因此**同一 trigger 的第二次 fire 在第一次执行期间会被跳过**（而非排队），不可能与 `boundSessionId` 的读-建-写回竞争。这是对所有模式都生效的既有行为，本次不新增锁结构。副作用：并发的第二次触发被静默丢弃（不排队），与历史行为一致。

### 4. 校验

`packages/core/src/trigger/validation.ts` 的 `requiresTargetSession` 保持不变：

```ts
return mode === "existing_session" && !targetSessionId;
```

`reusable_session` 不需要 `targetSessionId`，自然通过校验。表单与 LLM tool 对 `reusable_session` 下的 `targetSessionId` 按 `new_session` 同样处理——**静默丢弃**，与现有 `new_session` 行为一致。

### 5. LLM tool 适配（`manage_trigger`）

`packages/core/src/tools/manage-trigger.ts`：

- `mode` schema 加 `Type.Literal("reusable_session")`，更新 description 说明三种语义
- **不暴露 `boundSessionId` 作为输入参数**；create/update 返回值包含完整 entry，agent 可读到当前绑定状态
- 新增 `action: "reset_binding"`：清空指定 trigger 的 `boundSessionId`（下次触发重建），返回更新后的 entry

### 6. 服务端 API

- 三处 contract schema 加第三个 literal（见第 1 节）
- 新增 `POST /api/projects/:projectId/agents/:agentId/triggers/:triggerId/reset-binding`：清空 `boundSessionId`，返回更新后的 entry，并 emit `trigger_updated`。镜像现有 `POST .../run` 的「动词型端点」模式，避免污染通用 create/update 契约
- 路由层 `isValidTriggerMode`（`packages/server/src/routes/trigger.ts:9-11`）无需修改

### 7. UI

`packages/app/src/features/agent-trigger/TriggerForm.tsx`：

- 模式选择器从 2 项变 3 项，**维持 3 列网格**（`grid-cols-3`）。字面量数组加 `reusable_session`；i18n key 选择由三元改为映射查表
- `existing_session` → 显示 `targetSessionId` 输入（不变）
- `reusable_session` → 只读展示绑定状态：已绑定显示 `已绑定会话: <id>` + 「解除绑定」按钮（调 reset-binding 端点）；未绑定显示「尚未绑定（首次触发时自动创建）」
- 新建 trigger 时**默认选中 `reusable_session`**（见第 8 节）

`trigger-form-helpers.ts`：

- `emptyTriggerDraft()`：`sessionMode` 默认值由 `"new_session"` 改为 `"reusable_session"`，`boundSessionId` 默认空
- `entryToDraft(entry)`：读取 `entry.boundSessionId` 供展示
- `draftToTriggerData(draft)`：对 `reusable_session` 丢弃 `targetSessionId`；**永不发送 `boundSessionId`**（create/update 不含此字段）

### 8. 默认模式变更

将新建 trigger 的默认 `mode` 从 `new_session` 改为 `reusable_session`。影响点：

- 前端 `emptyTriggerDraft()`（第 7 节）——唯一真正变更默认值的位置
- `manage_trigger` tool：`mode` 在 create 时为**必填**，不引入默认值；agent 显式传入。仅更新 tool description 的措辞，把 `reusable_session` 作为推荐项提及
- 服务端 create 路由：`mode` 仍为必填，不强制默认

> 注：存量 trigger 不受影响（它们已持久化了各自的 `mode`）。仅 UI「新建」时默认值改变。

### 9. i18n

zh-CN 为基准（带注释，描述出现位置/上下文），同步 en / zh-TW。新增 key：

- `agent-trigger.modeReusableSession`：「首次新建后复用」
- `agent-trigger.boundSession`：「已绑定会话」
- `agent-trigger.boundSessionNone`：「尚未绑定（首次触发时自动创建）」
- `agent-trigger.clearBinding`：「解除绑定」
- 模式 helper 描述（如需在按钮下补充说明）

### 10. 测试

**core**
- `trigger-manager.test.ts`：新增 reusable 三例——首触发建会话并写回 `boundSessionId`、再触发复用、绑定会话被删除→重建；顺带补目前缺失的 `existing_session` restore 路径集成测试；覆盖按 triggerId 串行化
- `manage-trigger.test.ts`：`reusable_session` create；`reset_binding` action；`requiresTargetSession` 对 reusable 不触发
- validation：`reusable_session` 无 target 通过

**app**
- `trigger-form-helpers.test.ts`：`reusable_session` 丢弃 `targetSessionId`、不发 `boundSessionId`；`entryToDraft` 读取 `boundSessionId`；默认 draft 为 `reusable_session`
- `TriggerFeature.structure.test.ts`：更新结构断言（默认值、新字段）

**server**（若有 route 测试）：reset-binding 端点；reusable mode 通过校验

### 11. 文档与 Backlog

- 更新 `docs/official/data-conventions.md:116`：`mode` 三值说明 + `boundSessionId` 字段说明
- 检查 `docs/official/architecture.md` trigger 段是否需补充
- 更新 `docs/dev/backlog.md` 对应条目

## 修改清单（按文件）

**类型 / schema**
- `packages/core/src/types.ts` — `TriggerEntry.mode` 加 `reusable_session`、加 `boundSessionId?`
- `packages/server/src/contracts/trigger.ts` — 三处 schema（第 1 节）
- `packages/app/src/features/agent-trigger/trigger-form-helpers.ts` — `TriggerSessionMode`、默认值、序列化

**运行时**
- `packages/core/src/trigger/trigger-manager.ts` — `fire()` 重构为 switch + reusable 分支 + 按 triggerId 串行化 + `sessionExists`
- `packages/core/src/trigger/validation.ts` — 无需改（确认）

**LLM tool**
- `packages/core/src/tools/manage-trigger.ts` — mode schema、`reset_binding` action

**服务端**
- `packages/server/src/routes/trigger.ts` — `reset-binding` 端点

**UI**
- `packages/app/src/features/agent-trigger/TriggerForm.tsx` — 3 列网格、条件展示绑定状态、解除绑定按钮
- `packages/app/src/features/agent-trigger/store.ts` — reset binding action（若 store 负责 API 调用）

**i18n**
- `packages/i18n/src/locales/zh-CN.ts`、`en.ts`、`zh-TW.ts`

**测试**
- `packages/core/src/trigger/__tests__/trigger-manager.test.ts`
- `packages/core/src/__tests__/tools/manage-trigger.test.ts`
- `packages/app/src/features/agent-trigger/trigger-form-helpers.test.ts`
- `packages/app/src/features/agent-trigger/TriggerFeature.structure.test.ts`

**文档**
- `docs/official/data-conventions.md`
- `docs/dev/backlog.md`
