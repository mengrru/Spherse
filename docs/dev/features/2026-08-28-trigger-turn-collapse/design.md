# Trigger 对话轮折叠设计

- 日期：2026-08-28
- 状态：已实施

## 背景与问题

Trigger 以 `existing_session` / `reusable_session` 模式向既有 session 注入 user message 时，该消息与用户手打的消息在数据层逐字节同构——`user/message` event data 只有 `{ message }`（`events.ts:9`），session 级 `source` 列只标记 session 创建来源，无法区分单条消息。reusable session 积累多轮后，聊天界面被 trigger 轮与用户轮交错填充，trigger 轮（通常是例行汇报类产出）挤占视觉空间。

目标：trigger 发送的 user message 所在的 agent turn（该 user message 到本轮 run 结束的全部消息）在聊天 UI 中默认折叠为一个摘要条；用户可手动展开，展开后不再被自动收起。不处理存量数据（旧 trigger 消息无标记，自然不折叠）。

## 决策

| 决策点 | 结论 |
|---|---|
| 标记位置 | 扩展 `user/message` event data，加可选字段——**不新增 event type**。折叠是 user message 自身的属性，与消息同生命周期；独立 marker event 需要与后续 `user/message` 配对，且 `turn/withdrawn` 的 seq 排除（`fold.ts:91`，从 user message seq 向后排）会让先行的 marker 存活成孤儿，投影层需要额外清理。可选字段对旧数据天然兼容（absent = 非trigger），`EVENT_SCHEMA_VERSION` 不升级（与 `data-conventions.md` additive 不升版约定一致） |
| 字段形状 | `source?: "triggered"` + `triggerName?: string`（与 session 级 `source: "manual" \| "triggered"` 命名对齐；absent = 手动发送）。字段放在 event data 外层，**不进 `AgentMessage` 本体**——`agent-runner.ts:160` `agent.prompt(userMessage)` 复用同一对象，本体加字段会进入 LLM 上下文 |
| triggerName 取值 | 复用 executor 现有回退逻辑（`executor.ts:61`）：`entry.name || (type === "time" ? cron : eventName)` |
| 到达路径 | 只走历史投影（REST `GET .../sessions/:id/messages?limit=`）。trigger turn 绕过 chat WS，前端本就靠 `trigger_completed` 后 `refreshHistory` / 重连对账（`chat-session-runtime.ts:105` 初载、`loadMore`）拿到数据，三条路径全走分页端点，实时流协议零改动 |
| 折叠交互 | 纯折叠：折叠态只渲染摘要条（不预览 turn 产出）；默认折叠，用户展开后不再收起（标记不可变，展开后无再收起的触发源，纯本地 state 即可） |
| 失败 turn | 照常折叠，摘要条加错误徽标；错误详情与 retry 入口在展开态可见（`_error`/`onRetry` 均渲染在气泡内，`MessageItem.tsx:88`、`MessageList.tsx:85`） |
| withdraw 可达性 | 折叠态不渲染 `WithdrawButton`（不露出）；展开后若该 user message 是 withdrawable 索引则正常显示。无特殊处理 |
| new_session 模式 | 行为一致，接受：该模式下 session 仅一轮 trigger turn，打开即一个折叠条，点开看内容 |
| 流式中折叠 | 无此场景：trigger turn 不走 WS，到达即完整，直接以折叠态渲染 |

### 已确认的产品决策

1. 摘要条文案：`触发器「{name}」触发的对话轮`（i18n，zh-CN 基准；`triggerName` 缺失时回退通用文案）
2. 折叠态不预览 turn 产出，纯折叠
3. 折叠态不露出 withdraw 按钮
4. trigger turn 进行中打开 session 的场景：turn 完成后整段以折叠态出现，接受
5. 失败的 trigger turn 照常折叠，摘要条显示错误徽标
6. new_session 模式整 session 皆 trigger 轮，全部折叠，接受

## 契约

### event log（core 内部）

```ts
// events.ts SessionEventMap
"user/message": { message: AgentMessage; source?: "triggered"; triggerName?: string };
```

写入侧：trigger 路径写 `{ message, source: "triggered", triggerName }`；手动路径（chat WS / REST send）不写字段。

### REST `GET .../sessions/:id/messages?limit=`（分页端点）

```jsonc
{
  "entries": [
    { "id": 42, "message": { /* AgentMessage 原样 */ }, "source": "triggered", "triggerName": "每日汇报" }
  ],
  "hasMore": true,
  "oldestId": 42
}
```

`source` / `triggerName` 为 `Type.Optional`；未触发的条目不携带。`parseContract` 走 `Value.Parse` 会剥掉 schema 未声明字段，**契约必须显式声明**（`contracts/sessions.ts:41` `sessionMessagesPageResponse`；客户端 `api.ts` 共享同一 schema，改一处两端生效）。非分页端点（无 `limit` 的 `getSessionHistory`）返回裸 message 数组，形状不变——记为已知边界（聊天 UI 只消费分页端点）。

## 各层实现

### core

1. `session/events.ts`：`"user/message"` data 加 `source?: "triggered"; triggerName?: string`
2. `session/agent-runner.ts` `sendMessage`：加第 4 参 `meta?: { source?: "triggered"; triggerName?: string }`，`appendBatch` 时按存在性展开写入（absent 字段不写）
3. `session/session-manager.ts` `sendMessage`：透传 meta
4. `kernel/ports.ts` `SessionPort.sendMessage` + `packages/core/src/factory.ts:103-110` 装配处（`sendMessage: (sessionId, message, onEvent) => ...`）：加 meta 参数透传
5. `trigger/executor.ts` `fire`：调 `session.sendMessage` 时传 `{ source: "triggered", triggerName }`（triggerName 复用 L61 现有计算）
6. `session/fold.ts`：`DerivedMessageEntry` 加 `source?` / `triggerName?`，`deriveHistoryEntries` / `deriveMessageEntries` 从 event data 带出。注意 `deriveMessageEntries` 也用于 restore 时重建 agent buffer——多余字段只增不改 `message` 本体，消费方安全；withdrawn / abandoned 排除逻辑自动生效（标记与 user message 同 seq）
7. `project-manager.ts` `getRecentSessionHistory`：entries 投影加字段

### server

8. `contracts/sessions.ts`：`sessionMessagesPageResponse.entries[]` 加 `Type.Optional(Type.Literal("triggered"))` 的 `source` + `Type.Optional(Type.String())` 的 `triggerName`

### app

9. `features/chat/types.ts`：`ChatMessage` 加 `_triggered?: true` + `_triggerName?: string` 两个字段（`_` 前缀 view 投影约定）——分组判 `_triggered`（`source === "triggered"` 即设置，与 triggerName 是否存在解耦），摘要条文案判 `_triggerName`（缺失回退通用文案）
10. `features/chat/model/chat-history.ts` `parseHistoryMessages`：**entry 归一化步骤（L67-71 重建 `{id, message}`）需保留 `source`/`triggerName` 字段**，user message 分支读取后写入 `_triggered`/`_triggerName`
11. 新增 turn 分组派生（`features/chat/model/turn-groups.ts`）：从 `ChatMessage[]` 按 user message 边界切分（参考 `findRunStart` 的边界算法），产出 `TurnGroup[]`：

    ```ts
    type TurnGroup =
      | { kind: "plain"; item: { message; index } }
      | { kind: "trigger"; items: Array<{ message; index }>; triggerName?: string; hasError: boolean };
    ```

    **items 显式携带原始 chronological index**——`MessageItem` 的 `isLast` / `showTime`（`messages[index + 1]?.role === "user"`）/ `onWithdraw`（`index === withdrawableIndex`，索引来自 `lastWithdrawableUserIndex(messages)`）/ React `key` 全部按原始 index 计算，分组不改变这些接线的语义。分组只在 `MessageList` 渲染层 useMemo 派生，不改 store / reducer
12. `features/chat/MessageList.tsx`：渲染前先分组再组级 reverse；`trigger` 组包进 `Collapsible`（`components/ui/collapsible.tsx`）——折叠态仅渲染摘要条（chevron + `触发器「{name}」触发的对话轮`，`hasError` 时加错误徽标），展开态按原逻辑渲染组内 MessageItem。组内消息按时间正序渲染在 `flex flex-col gap-3` 容器内（reverse 发生在组级别，组内不再 reverse）；组以 trigger user message 的 `_messageId` 为 React key，保证 loadMore 重分组时已有组状态稳定
13. i18n：`chat.triggerTurnSummary`（带 `{name}` 插值）、`chat.triggerTurnSummaryFallback`（无 name 通用文案）、`chat.triggerTurnErrorBadge`（错误徽标），zh-CN 基准，按 i18n skill 流程补全其他 locale
14. DOM / theming 同步：折叠容器属于 `data-chat-messages` 子树，不改既有 `data-chat-message` / `data-chat-bubble` 钩子；摘要条加 `data-chat-turn-collapse` 钩子供 agent theme 定位；同步 `packages/presets/templates/agent-theme-template.css` 与两个 theme skill（`theming.md:72` 同步契约）
15. structure test：现有守卫为 `MessageItem.structure.test.ts` / `Composer.structure.test.ts` / `Header.structure.test.ts` / `HtmlCard.structure.test.ts`（无 chat.tsx 级测试）；新增摘要条 `data-chat-turn-collapse` structure 守卫

### 测试

- core：fold 投影带出 source/triggerName；withdrawn 后标记随消息一起被排除；AgentRunner 写入路径（手动不带 meta、带 meta 落盘正确）——装配级测试参照 `__tests__/session/p2-behaviors.test.ts:120` 模式；`executor.test.ts` 现有 SessionPort 是 mock 的，需补一条不 mock 被测方法的 executor → event log 断言
- server：分页契约测试（带 source/triggerName 字段 round-trip、无字段条目兼容）
- app：`turn-groups` 分组单测（trigger 轮边界、混合 session、items 携带原始 index、hasError 派生）；`parseHistoryMessages` 透传 `_triggered`/`_triggerName`（含归一化保留字段）；跨页 loadMore 合并出 trigger 组不丢消息；摘要条 structure test
- desktop 无 `SessionPort.sendMessage` 消费方（已核实），契约测试红线由上述 core 装配级测试 + server 契约测试承担

## 风险与边界

- **loadMore 跨页拼出 trigger 组**（接受）：分页边界可能切开 trigger turn——首页只见 turn 尾部 assistant（平铺），loadMore 拉到 trigger user message 后合并重分组，视口上方内容高度突变（折叠变矮），现有"捕获 scrollTop → 渲染后恢复"按纯 prepend 设计无法完全补偿，出现一次阅读位置跳动。组 key 以 trigger user message `_messageId` 为准保证其余组状态稳定；app 测试覆盖「跨页合并不丢消息」
- **失败 turn 的 retry 藏在展开态**（接受）：摘要条错误徽标提示失败，用户需展开才能 retry；错误可见性由徽标保证，详情交互代价可接受（产品决策 #5）
- **非分页 messages 端点不带标记**（接受）：聊天 UI 三条到达路径全走分页端点；非分页端点消费者（若有）看不到来源信息
- **`triggerName` 缺失**：`TriggerEntry.name` 可选且 type 回退保证非空（time→cron、event→eventName，两者为触发必要条件）；脏数据下摘要条回退 `triggerTurnSummaryFallback`（数据形状由 `_triggered`/`_triggerName` 两字段支持，回退非死代码）
- **折叠与贴底滚动**：组容器成为 `flex flex-col-reverse` 的直接子元素，末组（最新消息）折叠时高度变小，不破坏"末条在底部增长、原生贴底"机制；`load-more` 与 ThinkingIndicator 位置不受影响（均为列表级元素）
- **`mergeHistoryMessages` 对账**：新字段挂在 message 对象上随 `_messageId` 去重合并，无额外处理
- **存量数据**：旧 `user/message` 事件无 `source` 字段 → 不折叠，符合"不考虑存量"

## E2E

影响 chat 渲染，实施后优先运行：`chat-withdraw.spec.ts`（折叠态 withdraw 不露出）、`chat-retry.spec.ts`（错误徽标 turn 展开 retry）、`floating-chat.spec.ts`（共用 MessageList）。

## 文档同步（doc-sync 清单）

- `docs/official/architecture/chat.md`：`_` 前缀 view 字段清单加 `_triggered`/`_triggerName`；分页 entry 形状描述加可选 source/triggerName
- `docs/official/project-structure.md`：新增 `features/chat/model/turn-groups.ts`
- `packages/presets/templates/agent-theme-template.css` + 两个 theme skill：`data-chat-turn-collapse` 钩子（实施备注：`spherse-create-ui-theme/SKILL.md` 的 chat 节仅为示例、不维护钩子清单，钩子权威表在 agent-chat-theme skill 与 `theming.md`，已同步后者——ui-theme skill 记为豁免）
- `docs/official/data-conventions.md`：`user/message` event data 可选字段（若该文档维护 event 形状清单）
