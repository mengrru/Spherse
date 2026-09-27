# 聊天工具调用折叠（卡片即白名单）设计

- 日期：2026-09-27
- 状态：迭代 1、迭代 2 均已实施

> **迭代 2（用户反馈）**：迭代 1 只把工具调用折叠在 assistant 气泡内部，用户预期是**纯工具调用的 assistant message 不渲染气泡**，整轮工具调用统一收进一个「思考过程」折叠块（执行中显示「正在思考…」）。已确认方案：**一轮统一思考块**——turn 内所有工具调用（含与文本混发的）收进 turn 开头一个块，文本气泡变为纯文本。详见文末「迭代 2：turn 级思考块」。

## 背景与目标

当前 assistant 气泡内所有工具调用平铺渲染为 `ToolItemView` 行（工具名 + 参数摘要 + 状态，`AssistantBubble.tsx` L97-107 的虚线分隔区），有卡片的工具（render_card / generate_image / run_command / ask_user）在此基础上**再**渲染一张卡片。agent 一轮动辄几十个 read_file / search 调用，工具行把正文挤得很远，真正有用户价值的产出物（图、卡片、审批）淹没在过程噪音里。

改造目标：

- **卡片即白名单**：会投影出 `ChatCard` 的工具以卡片形式突出展示，**不再重复渲染工具行**
- 其余工具调用收进一个可折叠的「执行过程」容器（默认收起，展开后仍是现有个体工具行）
- write_file / edit_file 的工具行同样折叠（完成的写入仍有 `runChanges` FileViewerCard diff 呈现；失败的写入在折叠区有 error 徽章）

## 已确认的产品决策

1. 白名单数据驱动：`tool.card != null` 即白名单，不维护工具名清单；未来新增卡片工具自动进白名单
2. 有卡片的工具去掉重复的 `ToolItemView` 行，卡片是它们的唯一呈现
3. write_file / edit_file 工具行一并折叠
4. 不做用户可配置开关

## 决策

| 决策点 | 结论 |
|---|---|
| 白名单判定 | `tool.card != null`（渲染时过滤，`AssistantBubble` 内拆 `plainTools` / `cards`）。`card` 由 `projectToolCard` 从 control / details / partialResult 投影，审批类（run_command / ask_user）与产出类（render_card / generate_image）天然覆盖，无需硬编码工具名 |
| 数据层 | **零改动**。`entry-reducer` / `message-group` / `tool-item` / `tool-card` 全部不动；改动纯渲染层（`AssistantBubble` + 新组件）。孤儿 `tool-result` 气泡（`MessageList` L102-116）复用同一 `AssistantBubble`，自动获得一致行为 |
| 新组件 | `ToolProcessSection.tsx`：接收 `tools: ToolItem[]`（已过滤无 card），内部 base-ui `Collapsible` 受控渲染 `ToolItemView` 列表。放在 `AssistantBubble` 原工具区位置（虚线分隔保留在摘要行容器上） |
| 默认开合 | 无用户交互时 `open = delayedHasRunning`：`delayedHasRunning` 为 `hasRunning` 的 **250ms 延迟版**——running 持续 ≥250ms 才自动展开（保留长跑工具「正在做什么」的即时感知），结束 / 全部完成立即自动收起。延迟同时消解 card 投影跳变（见下两行）。用户手动 toggle 后进入用户意图态，不再自动变更（即使同气泡内后续又有新工具开始 running）——与 HtmlCard `userTouched` 同一原则，实现用 `useState<boolean \| null>(null)` 三态：`open = userOpen ?? delayedHasRunning` |
| 250ms 展开延迟实现 | `ToolProcessSection` 内部：`const [delayed, setDelayed] = useState(false)`（初始恒 false，首挂即 running 也走延迟）；effect 中 `hasRunning` false→true 时 `setTimeout(250)` 置 true（cleanup 清定时器），true→false 立即置 false；`userOpen !== null`（用户已接管）时不再同步 |
| 摘要行 | 参照 `TriggerTurnGroup` 摘要条样式（chevron + 文案 + 状态徽章）：标题「执行过程」+ 调用计数 + running spinner + error 计数徽章。error 不改变默认开合（`ToolItemView` 展开态也只有 args，展开看不到更多错误信息，徽章标记即可） |
| card 投影时序跳变 | toolCall part 出现到工具首次 `onUpdate` / `control_request` 之间 card 尚未投影，白名单工具会短暂出现在折叠区、card 到达后「升级」为卡片并从折叠区消失。窗口通常 1-2 帧（`message_end` / `tool_execution_start` / `control_request` 是独立 WS 事件）；配合 250ms 展开延迟，此类工具**不会触发自动展开**，用户感知仅为收起态摘要行的短暂闪现（接受）。已知较长窗口：render_card 的 `onUpdate` 在异步文件读取之后（`render-card.ts`），大文件可能超 250ms——此时展开后卡片到达、工具从折叠区移出，属「工具升级为卡片」的正常语义。render_card 错误路径（denied / 文件不存在 / 参数缺失）不产出 card，工具留在折叠区（数据驱动白名单下行为正确）。generate_image 起手即 onUpdate（`generate-image.ts`），窗口极短 |
| section 恒挂载 | `AssistantBubble` **无条件**渲染 `<ToolProcessSection tools={plainTools}>`，组件内部 `tools.length === 0` 时 return null（hooks 在 early return 之前调用）。若条件渲染 `{plainTools.length > 0 && ...}`，唯一 plain 工具升级为卡片时组件卸载、`userOpen` 丢失，后续新 plain 工具重挂载会违背「用户手动收起后不再自动展开」。恒挂载下 state 天然保留 |
| 中断 / abort 窗口 | 既有数据局限：`applyError` 不更新 tool status，连接断开 / abort 后工具永态 `running`。新 UI 下表现为 section 持续展开 + spinner 旋转，比今天的平铺 `...` 更显眼，但错误本身已有 `ErrorMessageSection` 呈现。接受并记录 |
| 有 card 工具的 superseded 折叠 | HtmlCard 的 `supersededToolCallIds` 机制不受影响（作用于卡片 `defaultCollapsed`，与工具行无关） |
| ThinkingContent | 本期不渲染真实 thinking part（需动 `entry-reducer` / `history-entries` 两条入口，另立条目）；容器命名与文案用「执行过程」而非「思考」，避免语义错位。组件设计上不排斥未来把 thinking 内容并入同一折叠区 |
| 主题钩子 | 容器根加 `data-chat-tool-process`，登记进 theming.md 可主题化入口表 |

## 契约

### `ToolProcessSection` props

```ts
interface ToolProcessSectionProps {
  tools: ToolItem[];              // 已过滤：全部无 card
  onNavigateToPath?: (path: string) => void;
}
```

### i18n（zh-CN 带注释，同步 en / zh-TW）

- `chat.toolProcess`：zh「执行过程」/ en `Tool activity`
- `chat.toolProcessCount`：zh「{count} 次调用」/ en `Calls: {count}`（i18n 无复数机制，规避「1 calls」语法瑕疵）
- `chat.toolProcessErrorCount`：zh「{count} 个失败」/ en `Failed: {count}`

## 各层实现

### `features/chat/`

- `ToolProcessSection.tsx`（新）：
  - hooks（全部在 early return 之前）：`const [userOpen, setUserOpen] = useState<boolean | null>(null)`、`const [delayedHasRunning, setDelayedHasRunning] = useState(false)` + 上述延迟 effect
  - `if (tools.length === 0) return null`
  - `const open = userOpen ?? delayedHasRunning`
  - `const errorCount = tools.filter(t => t.status === "error").length`
  - 摘要行：`CollapsibleTrigger`（ghost Button，全宽）内 chevron（旋转动画同 `ToolItemView`）+ 标题 + 计数 + running `LoaderCircleIcon` spinner + error 徽章（`AlertTriangleIcon`，destructive 色）
  - `CollapsibleContent` 内 `tools.map → ToolItemView`（复用，不改）
  - 外层保留原工具区的 `mt-2 border-t border-dashed border-border pt-2` 分隔样式
  - 根节点 `data-chat-tool-process`
- `AssistantBubble.tsx`：
  - L70 `cards` 不变；新增 `const plainTools = tools.filter(t => !t.card)`
  - L97-107 工具区替换为**无条件**的 `<ToolProcessSection tools={plainTools} onNavigateToPath={onNavigateToPath} />`（恒挂载，见决策表）
  - 卡片区（L115-139）不变：有 card 工具只经卡片呈现
- 其余文件（MessageList / TriggerTurnGroup / 模型层）不动

### i18n

- 三个 locale 加上述 key

## 测试

- `ToolProcessSection.test.tsx`（新）：
  - 全 completed 默认收起：工具名不可见，摘要（标题 + 计数）可见
  - running 持续（fake timers 超 250ms）后默认展开；running 不足 250ms 即完成 → 从未展开
  - running → 全部 completed 后自动收起（立即，不延迟）
  - 用户手动展开已完成的组 → 保持展开；用户手动收起 running 的组 → 保持收起，且后续新 running 工具不再自动展开
  - error 计数徽章显示，不改变默认开合
  - `tools` 由非空变空（工具升级为卡片）→ 返回 null；同组件实例再变非空 → `userOpen` 保留（恒挂载行为）
- `AssistantBubble.test.tsx`：
  - 「renders tool rows」更新：无 card 工具出现在执行过程折叠区内（默认收起时仅摘要可见，展开后 `read_file` / 参数摘要可见）
  - 新增：带 card 工具（如 image card）不渲染 `ToolItemView` 行，只渲染卡片
- `MessageList.test.tsx`：「renders an orphan tool result bubble」更新——孤儿 plain 工具默认收起，断言摘要行可见（base-ui Collapsible 收起态内容不在 DOM，原 `getByText("read_file")` 直接断言必挂，需先展开或断言摘要）
- E2E `chat-history-render.spec.ts`：
  - `getByText("run_command")` 工具行断言删除（CommandCard 不显示工具名），`getByText("printf history-ok")` 保留（由 command 卡的命令文本满足）
  - fixture（`helpers/chat-history.ts`）在工具轮补一个 plain 工具（如 `read_file`，无 card details），断言执行过程摘要行渲染 + 点击展开后工具行可见——E2E 覆盖新交互的最小闭环
- 回归：`ui-sdk-html-card.spec.ts`（render_card 卡片不受影响）、`chat-v2-replay.spec.ts`、`chat-streaming-resilience.spec.ts`（streaming 中工具经折叠区呈现）

## 文档同步

- `docs/official/architecture/theming.md`：可主题化入口表加 `data-chat-tool-process`
- `docs/official/project-structure.md`：chat feature 新文件 `ToolProcessSection`
- theme skills（`packages/presets/skills/` 两个）：检查是否需要补 `data-chat-tool-process` 描述
- `docs/dev/backlog.md`：新增「渲染 ThinkingContent 到执行过程折叠区」（需动 entry-reducer / history-entries 两条入口提取 thinking part，本期明确不做）

## 风险

- E2E / 组件测试中依赖工具行平铺可见的断言需跟随更新（已排查：`chat-history-render.spec.ts` 一处、`MessageList.test.tsx` 孤儿气泡一处）
- 白名单工具在 card 投影前的短暂折叠区出现（见决策表），流式重放（replay）场景下整段历史一次性加载，窗口不可感知
- 用户主题若针对原工具区 DOM 结构（`ToolItemView` 直接挂在虚线容器下）写了选择器，嵌套一层 Collapsible 后结构变化；按 theming 契约检查 theme skills

## Design review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| I-1 | important | auto-expand 无延迟时，card 投影跳变窗口内折叠区会展开-收起闪烁（尤其纯 run_command/ask_user 审批轮，「收起态仅计数变化」的前提不成立） | 采纳：`open` 改用 `hasRunning` 的 250ms 延迟版（快升级的卡片工具永不触发自动展开），并修正决策表跳变论述（含 render_card 异步读取 / 错误路径） |
| I-2 | important | 测试排查遗漏 `MessageList.test.tsx` 孤儿气泡断言 `getByText("read_file")`，base-ui Collapsible 收起态内容不在 DOM，改后必挂 | 采纳：测试计划补 MessageList.test.tsx 更新 |
| M-1 | medium | `{plainTools.length > 0 && ...}` 条件卸载丢 `userOpen`，后续重挂载违背「用户手动收起后不再自动展开」 | 采纳：AssistantBubble 无条件渲染，组件内部空 tools 时 return null（恒挂载保 state），补测试 |
| M-2 | medium | 连接断开 / abort 后工具永态 running，section 卡在展开态 + spinner | 接受并记录（既有数据局限，错误已有 ErrorMessageSection 呈现），写入决策表 |
| m-1 | minor | 「render_card 执行开始即 onUpdate」不准确：onUpdate 在异步文件读取后，错误路径不产出 card | 采纳：决策表叙述修正 |
| m-2 | minor | en 无复数机制，「{count} calls」在 count=1 有语法瑕疵 | 采纳：en 用 `Calls: {count}` / `Failed: {count}` |
| m-3 | minor | E2E 不覆盖折叠区展开交互 | 采纳：fixture 补 plain 工具 + 摘要行 / 展开断言（最小闭环） |
| m-4 | minor | 「write_file 信息不丢」过强：失败的 edit 只有 error 徽章 | 采纳：目标节措辞修正 |
| m-5 | minor | theming.md L47 结构四层仍写已拆分的 `MessageItem`（pre-existing） | 采纳：doc-sync 时顺手修正 |

## Code review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| M-1 | medium | design doc「文档同步」四项（theming.md 入口表、project-structure.md、theme skills、backlog 条目）均未落 | 采纳：收尾 doc-sync 阶段补齐（见后续 commit） |
| m-1 | minor | design doc 决策表 `useState(false)` 与实现节 `useState(hasRunning)` 自相矛盾（实现为 false） | 已修：design.md 实现节改为 `useState(false)` |
| m-2 | minor | 折叠触发 `onOpenChange` + 显式 `onClick` 双通道冗余（仓库模式二选一） | 已修：删 `onClick`，保留受控 `onOpenChange={setUserOpen}`（4037f70e） |
| m-3 | minor | ToolProcessSection.test 的 `use-connection` mock 为复制残留（组件导入链无该依赖） | 已修：删除，测试全过（4037f70e） |
| 疑点 1 | — | E2E 未运行 | 不成立：提交前已实跑 `chat-history-render`（1 passed）+ `ui-sdk-html-card` / `chat-v2-replay` / `chat-streaming-resilience`（7 passed） |
| 疑点 3 | — | 仅跑 packages/app 的 lint/typecheck | 不成立：已跑全仓 `npm run lint` / `npm run build` / `npm run typecheck` 均通过 |

## 迭代 2：turn 级思考块

日期：2026-09-27（用户反馈迭代）

### 背景与产品决策

迭代 1 折叠发生在 assistant 气泡内部，纯工具调用的中间 message 仍各自渲染一个空气泡。用户预期：一轮（user message 到 turn 结束）内**所有工具调用**统一收进 turn 开头的一个「思考过程」折叠块，执行中显示「正在思考…」，文本气泡变为纯文本。已确认：

1. **一轮统一思考块**：turn 内所有 assistant entry 的 toolCalls（含与文本混发的）合并进一个块；带文本的 message 只渲染文本（不再有气泡内「执行过程」折叠区）
2. 卡片即白名单语义不变：块内工具的卡片（html / image / command / approval / question）渲染在块下方，保持可见
3. 迭代 1 的 `ToolProcessSection`（气泡内折叠区）被本方案完全取代，删除

### 决策

| 决策点 | 结论 |
|---|---|
| 数据结构 | `message-group.ts` 新增 `ThoughtBubble`：`{ kind: "thought"; id; entryId; seq?; tools: ToolItem[]; awaiting?: true; runChanges? }`。**锚点取 turn 内第一个 assistant entry（无论是否含工具）**，`id = b:thought:{entryId}`、`entryId` / `seq` 同源——锚点在首个工具到达前后不变，避免 React key 翻转打破恒挂载（entry id 在会话内稳定：transient id 不随 seq 替换，`history-entries.ts` 合并保留现有 id）。`awaiting` = 存在 `streaming` 且 `text===""` 且 `toolCalls` 为空的 entry（等待首 token，含 turn 中段新 entry 开场）。`AssistantBubble.tools` 字段删除，文本气泡纯文本 |
| 组装（assembleGroups） | 每个 turn 收集：① 所有 assistant entry 的 toolCalls 展开为 ToolItem（流式态 `status: "running"`，同现状 `assistantBubble()` 构造）；② tool-result 合并三步（对齐现状语义）：`ownerId` 命中本 turn 任一 assistant entry → 合并进块内 tools；ownerId 缺失/未命中 → **按 toolCallId 匹配块内已收集 tools 兜底**（loadMore 跨页时 owner 与 result 分属两页、`pairToolResultOwners` 只做单页配对，兜底是唯一合并路径）；仍不中 → 孤儿气泡（现状不变）。`mergeToolResult` 复用（含 push-if-not-found）。块位置：turn 内第一个 bubble（user 之后、所有文本气泡之前） |
| 文本气泡 | assistant entry `text` 非空 → 文本气泡（无 tools）；`text` 为空且无 error → 不产生气泡（其工具已在块内）。**`text` 为空但有 `error` → 仍渲染 error 气泡**（错误可见性；现状 `data-chat-error` 断言与 retry 定位依赖它） |
| 块的挂载与渲染条件 | turn 内存在任一 assistant entry 即挂块。渲染层：`tools.length > 0` → 渲染；`tools` 为空时仅 `awaiting` 渲染（「正在思考…」，覆盖 turn 开场与**中段新 entry 等待首 token**——纯 turn 级 `!hasText` 会丢中段指示）；其余（如纯文本 turn 已有正文）不渲染。text 空变非空的退场与文本气泡出现出自同一次 `assembleGroups` 重算，原子切换无闪烁 |
| 块开合状态机（turn 级） | `open = userOpen ?? delayedOpen`，三态用户意图沿用迭代 1。**触发与收起分离**：自动展开触发 = `tools.some(running)` 持续 250ms（空 tools 的等待态只 spinner，不触发展开）；自动收起 = 块 `active` 变 false 时统一收起（而非 hasRunning 归 false——工具批次间隙 `message_end` 已到、下一 entry 首 token 未到，`hasRunning` 短暂 false，若即时收起会同块反复手风琴、推动下方文本气泡）。`active` 由渲染层传入：`streaming && 块所在 group 是最后一个 group`（MessageList 新增 session 级 `streaming` prop）。turn 结束：active false → 立即收起 |
| 卡片与 runChanges | 块内带 card 的工具卡片渲染在块（摘要行/展开区）**下方**，顺序与 tools 数组一致——卡片是即时产出，跟过程块保持时间序；`runChanges` 是 turn 级汇总（diff 总结性质），挂 turn 最后一个 assistant 气泡，无文本气泡时挂到 thought 块自身（分裂两处是自觉决策）。`supersededToolCallIds` / `onRespondApproval` / `onRespondQuestion` 回调从 AssistantBubble 移至 ThoughtBlock。`applyRunChanges` 收集源扩为 assistant + thought 气泡 |
| 时间戳 | ThoughtBlock props 加 `timestamp?` / `showTime?`（纯工具 turn 的 lastBubble 是块，时间戳展示责任随迁），取值锚定 turn 首 assistant entry 的 `time`（turn 开始时间，对 turn 级块语义自然）；`isRetryTarget` 落在块上忽略（retry 挂点实际由 error 气泡 / user 气泡承担） |
| 孤儿 tool-result | 仍产生 `{ kind: "tool-result" }` bubble，渲染改走 ThoughtBlock（`tools=[tool]`，与正常块形态一致；`supersededToolCallIds` 一并透传）。与旧实现的三处自觉偏移：① 渲染位置统一在 turn 文本气泡之后（旧为 entry 内联序，孤儿是兜底路径，形态统一优先）；② 不传 `active`（孤儿 turn 无 assistant entry，running 卡死本身是中断异常，不自动展开）；③ 无 `data-entry-seq` 锚点（搜索只索引文本，已核实无影响） |
| 派生函数 | `group-derivations.ts` 的 `bubbleTools` 加 thought 分支（superseded 计算、pendingControls 收集自动覆盖） |
| 文案（i18n） | 迭代 1 的 `chat.toolProcess*` 三 key 未发布，直接更名替换：`chat.thoughtThinking`（zh「正在思考…」/ en `Thinking...`）、`chat.thoughtProcess`（zh「思考过程」/ en `Thought process`）、`chat.thoughtProcessCount`（`{count} 次调用` / `Calls: {count}`）、`chat.thoughtProcessErrorCount`（`{count} 个失败` / `Failed: {count}`）。摘要行标题：awaiting / active 时用 `thoughtThinking`，定态用 `thoughtProcess` |
| 主题钩子 | `data-chat-tool-process` 更名为 `data-chat-thought`（未发布），登记同步 theming.md / chat theme skill / project-structure.md |

### 各层实现

- `model/message-group.ts`：`ThoughtBubble` 类型 + `assembleGroups` 重构（turn 级收集，见决策表）
- `model/run-changes.ts`：收集源与挂载点扩展
- `model/group-derivations.ts`：`bubbleTools` 加 thought 分支
- `ThoughtBlock.tsx`（新，替代并删除 `ToolProcessSection.tsx`）：props `{ tools: ToolItem[]; awaiting?; active?; timestamp?; showTime?; runChanges?; supersededToolCallIds?; onNavigateToPath?; onRespondApproval?; onRespondQuestion? }`；渲染：摘要行（chevron + 标题 + 计数 + spinner + error 徽章）→ 展开区（ToolItemView 列表）→ 卡片区（五类卡片分派，迁自 AssistantBubble）→ runChanges（FileViewerCard）
- `AssistantBubble.tsx`：纯文本化，删除 tools / cards / supersededToolCallIds / onRespondApproval / onRespondQuestion props 与卡片区；error 区保留
- `MessageList.tsx`：新增 session 级 `streaming` prop（`active = streaming && group 是最后一个 group`）；`renderBubble` 加 thought 分支 → ThoughtBlock；孤儿 tool-result 分支改走 ThoughtBlock；回调透传调整
- i18n：三 locale key 更名

### 测试

- `model/message-group.test.ts`：纯工具轮 → 单 thought 块 + 无文本气泡；混发轮（文本+工具 entry）→ 块含全部工具 + 文本气泡纯文本；空 text + error → error 气泡保留；块位置在文本气泡前；孤儿不受影响；**ownerId 缺失时组内 toolCallId 兜底合并（跨页场景）**；runChanges 挂载（有/无文本气泡两种）；awaiting 标记（streaming 空 entry）；块锚点 = turn 第一个 assistant entry（纯文本 entry 开场、工具后到时 id 不变）
- `ThoughtBlock.test.tsx`（由 ToolProcessSection.test.tsx 演化）：迭代 1 全部开合/延迟/意图用例迁移；新增：awaiting「正在思考…」态（tools 空）；**工具批次间隙（active true、tools 无 running）不收起**；**active false（turn 结束）统一收起**；空 tools 等待态不触发自动展开（250ms 后仍收起）；卡片区渲染与 superseded；runChanges 渲染；时间戳
- `AssistantBubble.test.tsx`：删除工具相关用例，保留文本/streaming/error 用例
- `MessageList.test.tsx`：孤儿气泡断言改 ThoughtBlock 选择器；顺序断言确认块在文本气泡前
- E2E `chat-history-render.spec.ts`：工具轮断言改 `[data-chat-thought]`（展开交互保留）；卡片断言（iframe / image / question / command 文本）不变（卡片跟块渲染仍在 DOM）；「工具总结文本」文本气泡不变
- 回归：`chat-streaming-resilience`（streaming 中块形态）、`chat-v2-replay`、`ui-sdk-html-card`、`global-search`（定位锚点 seq 保留在文本气泡）

### 风险

- `AssistantBubble` props 收窄是破坏性内部接口变更：MessageList 为唯一消费方，同步改
- 定位（`locateSeq`）：块聚合多 entry，seq 取首个来源 entry；文本消息定位不受影响（搜索只索引文本）
- 消息数量类断言（`data-chat-message` 计数）：纯工具 entry 不再是气泡，相关测试与 E2E 需核对

### 迭代 2 design review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| I-1 | important | turn 级 `!hasText` 丢中段等待指示（entry 1 文本完成后，entry 2 等 首 token 时无任何活动显示） | 采纳：`awaiting` 改为 entry 级判定（存在 streaming 且 text 空 toolCalls 空的 entry），覆盖开场与中段 |
| I-2 | important | 单块跨工具批次：批次间隙 hasRunning 短暂 false，250ms 状态机反复收起/展开（手风琴），推动下方文本气泡 | 采纳：触发与收起分离——展开由 `tools.some(running)` 触发；收起由块 `active` 变 false（turn 结束）统一执行，批次间隙保持 |
| I-3 | important | 块锚点取「第一个含工具 entry」会在首个工具到达时翻转 id → React key 变化重挂载，丢 userOpen | 采纳：锚点 = turn 第一个 assistant entry（无论是否含工具）；已核实 entry id 会话内稳定 |
| I-4 | important | 设计吞掉了组内 toolCallId 兜底合并（`findToolOwnerBubble` 对应逻辑），loadMore 跨页时同 turn 工具会退化为孤儿、diff 丢失 | 采纳：三步合并（ownerId → 组内 toolCallId → 孤儿）写入决策表与测试计划 |
| M-1 | medium | 纯工具 turn 的 lastBubble 是块，时间戳消失 | 采纳：ThoughtBlock 加 timestamp/showTime props |
| M-2 | medium | streaming 扩入 hasRunning 会让空 tools 等待态延迟展开成空展开区 | 采纳：自动展开条件仍用 `tools.some(running)`，等待态只 spinner |
| M-3 | medium | 测试缺中段等待、批次间隙、锚点稳定、跨页兜底、withdraw 重组装 | 采纳：补前四类；withdraw 走 removeSeqs 整 turn 删除（块随之消失），补一条 model 用例确认重组装即可 |
| m-1 | minor | `b:t:` 前缀与孤儿 bubble id `b:t1` 形近 | 采纳：改 `b:thought:{entryId}` |
| m-2 | minor | 卡片与 runChanges 分裂两处缺理由 | 采纳：决策表补「即时产出跟过程块 / turn 级汇总挂尾部」 |
| 1a | — | text 空变非空的帧级闪烁疑虑 | 核实不成立：块退场与文本气泡出现同一次 assembleGroups 重算，原子切换 |
| 2/3 | — | retry / global-search 定位依赖被删气泡 | 核实不成立：planRetry 基于 entries；搜索只索引文本，seq 锚点保留在文本气泡 |

### 迭代 2 code review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| I-1 | important | design 承诺的主题钩子文档同步未执行（theming.md / project-structure.md / chat theme skill / generated preset-skills） | 已修：doc-sync 阶段四处全部更新并重建 presets |
| M-1 | medium | AssistantBubble 空文本 ThinkingIndicator 分支死代码（组装层过滤 + applyError 强制 streaming false，状态不可达），测试固守不可达状态 | 已修：删除分支与用例（「正在思考」由 thought 块 awaiting 承担） |
| M-2 | medium | 孤儿三处语义偏移与 design「现状不变」表述矛盾（位置 / active / data-entry-seq） | 已修（文档）：决策表补记三处为自觉决策，不改代码 |
| m-1 | minor | 多 error entry + streaming target 时除最后一个外静默丢弃，违背错误可见性红线 | 已修：其余 error entry 走 standalone error 气泡 |
| m-2 | minor | standalone error 位置从内联序变为 turn 末尾 | 接受：错误后同 turn 续跑文本极罕见，保序复杂度不值 |
| m-3 | minor | 块时间戳取 anchor time（turn 首entry）语义未写明 | 已修（文档）：决策表补记锚定语义 |
| m-4 | minor | superseded 用例缺失 | 已修：补 `defaultCollapsed` iframe 计数断言 |
| m-5 | minor | 孤儿分支不传 supersededToolCallIds（计算与渲染不对称，pre-existing） | 已修：孤儿分支透传 |
| 疑点 | — | E2E / 全仓 verify 未跑 | 不成立：提交前已实跑（chat-history-render / ui-sdk-html-card / chat-v2-replay / chat-streaming-resilience / global-search / chat-retry / chat-withdraw 全过；lint / build / typecheck / check:i18n 全过） |

## 迭代 3：卡片按 entry 时序渲染

日期：2026-09-27（用户反馈迭代）

### 背景与产品决策

迭代 2 把卡片渲染在 thought 块内部（块位于 turn 开头），导致 turn 内所有卡片集中堆在「思考块与第一个文本气泡之间」，丢失了卡片与文本的时间顺序（如「先生成图 A → 说一句话 → 再生成图 B」中，A、B 都跑到了那句话之前）。用户反馈：卡片应与气泡按顺序渲染。已确认：**卡片按其所属 assistant entry 的时序位置渲染**，与文本气泡交错。

### 决策

| 决策点 | 结论 |
|---|---|
| 数据结构 | 新增 `CardsBubble`：`{ kind: "cards"; id: b:cards:{entryId}; entryId; seq?; tools: ToolItem[] }`——按 entry 分组的卡片工具（通常一个 entry 一个卡片工具，多 toolCall 时同组） |
| 组装 | `assembleBubbles` 对每个 assistant entry：无 card 的 toolCalls 收集进 thought 块（turn 开头，纯过程折叠）；有 card 的 toolCalls 生成 cards bubble **在该 entry 的位置**。同 entry 内顺序：文本气泡在前、cards bubble 在后（延续旧形态：正文先于产出物）。thought 块只剩 plain tools + awaiting 态；turn 内全是卡片工具时 thought 不渲染（tools 空） |
| 组件 | `ThoughtBlock` 删除卡片区（保留折叠块 / runChanges / timestamp / 开合状态机，简化回纯过程块）；新增 `ToolCards.tsx` 渲染卡片列表（五类卡片分派迁入，根节点 `data-chat-cards`），props 含 superseded / 审批回调 |
| 孤儿 tool-result | 数据保持 `{ kind: "tool-result" }` bubble；渲染层拆分：tool 带 card → `ToolCards`（卡片可见），否则 → `ThoughtBlock`（折叠行） |
| 派生函数 | `bubbleTools` 加 cards 分支（superseded / pendingControls 自动覆盖） |
| 主题钩子 | 新增 `data-chat-cards`（theming.md / chat theme skill / project-structure.md 同步） |
| runChanges | 不变：挂 turn 最后一个 assistant 气泡，无文本气泡时挂 thought 块 |

### 测试

- `message-group.test.ts`：卡片工具按 entry 位置生成 cards bubble、与文本气泡交错顺序；plain 工具仍全进 thought；同 entry 文本在前卡片在后；纯卡片轮无 thought DOM（tools 空）
- `ThoughtBlock.test.tsx`：删除卡片相关用例（迁出）
- `ToolCards.test.tsx`（新）：卡片渲染 / superseded 折叠 / 审批回调透传
- `MessageList.test.tsx`：cards 分支渲染与孤儿拆分（带卡孤儿 → 卡片可见；无卡孤儿 → 折叠块）
- E2E：`ui-sdk-html-card` selector 改 `[data-chat-cards] iframe`；`chat-history-render` 卡片断言位置变化但存在性不变

### 迭代 3 code review 处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| I-1 | important | 主题钩子文档同步声称已做实际未做（theming / skill / project-structure 缺 `data-chat-cards`，`data-chat-thought` 描述过时） | 已修：三处更新并重建 presets |
| I-2 | important | design 声称的 MessageList cards/孤儿拆分测试未写 | 已修：补 cards 交错渲染、带卡孤儿 → ToolCards、无卡孤儿 → 折叠块（原有）用例 |
| M-3 | medium | property test 的 joined 只扫 thought，cards 分拣丢工具不可发现 | 已修：joined 覆盖 thought + cards |
| M-4 | medium | runChanges 只扫 thought，依赖「write/edit 不产卡」的跨包隐式不变量，未来文件工具挂审批会静默丢 diff | 已修：收集源扩为全部 bubbles 的 tools（thought + cards + 孤儿），FILE_CHANGE_TOOLS 过滤天然排除卡片工具 |
| m-5 | minor | ownerIndex 兜底 `: 0` 分支不可达且静默 | 接受：防御性兜底，记录 |
| m-6 | minor | 纯卡片轮 settle 后时间戳丢失（thought 空渲染 null，末位 cards 无时间通道） | 已修：cards bubble 加 timestamp（entry time），ToolCards 支持 showTime |
| m-7 | minor | 「同 entry 文本在前卡片在后」无直接断言 | 已修：interleave 用例 a1 补文本，断言 `text:a1` 在 `cards:a1` 前 |
| m-8 | minor | ToolCards 回调只测 command | 已修：补 question 卡回调用例 |
