# 聊天工具调用折叠（卡片即白名单）设计

- 日期：2026-09-27
- 状态：待实施

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
  - hooks（全部在 early return 之前）：`const [userOpen, setUserOpen] = useState<boolean | null>(null)`、`const [delayedHasRunning, setDelayedHasRunning] = useState(hasRunning)` + 上述延迟 effect
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

（待 review 后填写）
