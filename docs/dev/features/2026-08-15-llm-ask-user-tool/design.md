# Design: LLM ask/question 工具（`ask_user`）

- 日期：2026-08-15
- 状态：待评审
- 需求来源：feat: 给 LLM 增加一个 ask/question 工具

## 1. 背景与动机

当前 agent 只能「一口气跑完」：模型若缺少关键信息或面临需要用户拍板的分叉，只能自行假设或结束轮次后让用户在下一轮补充。需要一个工具让 agent 在**运行中途**向用户提出一个问题、等待回答、拿到答案后**在同一个 run 内继续执行**后续工具链。

现有基础设施正是为此预留的：

- `SessionControlBus`（`packages/core/src/session/control-bus.ts`）以 `requestId` + `kind` 判别控制请求，`run_command` 的审批是首个 kind `"approval"`。`docs/official/architecture.md` §运行时控制请求明确写着「当前仅 `"approval"`，未来可扩展 steering / 参数询问等」——本 feature 就是那个预留的第二个 kind。
- 事件经 `AgentEventHandler` 与 chat WS 透传、`ChatSessionHub.runEvents` 支持晚订阅重放、断线重连对账、`ApprovalNoticeBridge` 跨会话 toast 通知——这些对「等待人类回答」的场景全部免费复用。

另一个关键约束决定了必须走 control bus：**run 活跃期间用户的普通消息会被 hub 单飞保护拒绝（session busy）**，所以「agent 提问 → 用户在输入框直接打字回答」这条路不通，回答必须经 `resolve_control_request` 回传到等待中的 tool execute。

## 2. 目标 / 非目标

**目标**

1. 新增内置工具 `ask_user`：agent 运行中向用户提一个问题（可选 2–6 个候选项），阻塞等待用户回答，答案作为 tool result 返回给模型，同一 run 内继续。
2. 聊天流内联 QuestionCard：待答态展示问题 + 候选项快捷按钮 + 自由文本输入；已答/超时态紧凑展示。
3. 复用既有 control request 管道：事件流、重放、重连、跨会话 toast 通知、超时与中断语义与 approval 对齐。
4. per-agent opt-in（profile `tools` 列表），新建 agent 默认启用（加入默认模板）。

**非目标（v1 明确不做）**

- 多选（一次勾多个选项）/ 结构化答案 schema 校验
- steering（运行中改指令、追加要求）——同一管道的潜在第三 kind，另行立项
- headless（trigger / 定时）运行中的提问通知推送（v1 走超时兜底，见 §7.3）
- 问题的富文本/Markdown 渲染（纯文本足够）
- 多用户/多答者语义

## 3. 方案对比

### 方案 A：`SessionControlBus` 新增 `"question"` kind（推荐）

`ask_user` 的 execute 经由 gate 适配器调 `bus.request(kind: "question")`，用户答案经 chat WS `resolve_control_request` 回传，`bus.resolve` 唤醒 execute。

- 优点：完全复用预留扩展点与全部管道（事件流 / runEvents 重放 / 重连对账 / ApprovalNoticeBridge / requestId 幂等 / abort rejectAll / 超时 fallback）；答案以 tool result 形式回到模型上下文，工具链不中断；实现量可控（三层 kind 硬编码本来就是待清的设计债）。
- 缺点：需要解开 `kind: "approval"` 在三处的硬编码（core `session/types.ts`、`control-bus.ts emitResolved`、server `contracts/websocket.ts`），approval 相关测试需回归。

### 方案 B：「提问即结束轮次」伪工具

ask 工具立即返回，问题以特殊消息形态结束当前 run；用户下一条普通消息作为答案，下一轮由模型自行关联。

- 缺点：①模型上下文与工具链断裂——答案到达时是新 user turn，ask 之后的既定步骤全部丢失，需重新规划；②问题与答案无 correlation key，多问、答非所问、用户不理会等场景语义模糊；③无超时语义，对话直接停滞；④toolCall 无 toolResult 的消息序列需要 sanitize 兜底（compaction 已有 orphaned toolResult 处理，反向再引入 orphaned toolCall 是倒退）；⑤「提问」变成两个 turn 的拼接，历史渲染、导出、压缩都要特判。

### 方案 C：`render_card` 交互式 HTML + UI SDK

渲染一个带表单的 HTML 卡片，用户提交后经 SDK `sendMessage` 发新用户消息。

- 缺点：同 B 的上下文断裂；答案变成普通 user message 而非 tool result；iframe 沙箱内输入体验、主题适配、焦点管理与原生 chat 脱节；复杂度高且与「卡片是展示物」的定位冲突。

**结论：采用 A。**

## 4. 选定方案：端到端数据流

```
LLM tool call: ask_user(question, options?, timeout_s?)
  → execute: 前置 abort 检查 → clamp timeout → AskGate.ask()
  → SessionControlBus.request(kind:"question", timeoutMs, {timedOut:true})
  → control_request 事件（经 eventSink）
  → ChatSessionHub: recordRunEvent + publish → chat WS → renderer
  → reducer: 在匹配 toolCall 上挂 QuestionCard(status:"pending", requestId)
  → 用户点选项按钮 或 输入文本点发送
  → ChatSessionRuntime.respondQuestion → WS resolve_control_request(kind:"question", answer)
  → ws-chat 按 kind 构造 decision → attachment.resolveControlRequest
  → LiveSession.resolveControlRequest → bus.resolve(requestId, {answer, timedOut:false})
  → execute 恢复 → toolResult(content=答案, details=question 卡) → 模型继续
  → control_resolved 事件广播 → 所有 UI 收敛卡片状态
```

超时：`bus` 定时器 resolve `{ timedOut: true }`，tool result 告知模型「用户未回答，自行判断继续，勿重复发问」。中断：`LiveSession.abort()` → `bus.rejectAll` → execute catch 后返回 aborted 文本结果（不 throw，run 已终止，结果仅落历史）。

## 5. 分层设计

### 5.1 Core（`packages/core`）

**类型扩展** — `src/session/types.ts`：

```ts
export type ControlRequestKind = "approval" | "question";

export type SessionControlEvent =
  | { type: "control_request"; requestId: string; kind: "approval"; ... }        // 不变
  | { type: "control_resolved"; requestId: string; kind: "approval"; ... }       // 不变
  | { type: "control_request"; requestId: string; kind: "question";
      toolCallId: string; toolName: string; args: unknown }                      // args = { question, options? }
  | { type: "control_resolved"; requestId: string; kind: "question";
      answer?: string; timedOut: boolean };
```

**`control-bus.ts`**：`emitResolved` 改为按 kind switch，`"question"` 分支发射 `{ answer, timedOut }` 形状。`request<T>/resolve/rejectAll` 本身零改动。

**gate 适配器** — 新文件 `src/session/ask-gate.ts`（镜像 `approval-gate.ts`）：

```ts
// tools/ask-user.ts 中定义接口（对称 ApprovalGate 放 with-approval.ts 的做法）
export interface AskGate {
  ask(req: { requestId: string; toolCallId: string; toolName: string; args: unknown },
      timeoutMs: number): Promise<AskOutcome>;
}
export interface AskOutcome { answer?: string; timedOut: boolean }

export function createAskGate(bus: SessionControlBus): AskGate {
  // bus.request<AskOutcome>({ kind: "question", ... }, timeoutMs, { timedOut: true })
}
```

超时 fallback decision `{ timedOut: true }`（answer 为 undefined）。

**工具** — 新文件 `src/tools/ask-user.ts`：

```ts
const AskUserParams = Type.Object({
  question: Type.String({ description: "The question to ask the user. Be specific and self-contained." }),
  options: Type.Optional(Type.Array(Type.String(), { minItems: 2, maxItems: 6,
    description: "Optional 2-6 candidate answers; rendered as quick-pick buttons, free text always allowed." })),
  timeout_s: Type.Optional(Type.Number({ description: "Wait cap in seconds, 60-3600, default 600." })),
});

export function createAskUserTool(askGate?: AskGate): AgentTool<typeof AskUserParams, AskUserDetails>
```

execute 行为：

1. `signal?.aborted` 前置返回 aborted 文本结果；
2. 防御性清洗 options：非字符串项剔除，清洗后 `< 2` 个则视为无 options（纯自由文本）；
3. clamp `timeout_s` 至 `[60, 3600]`，默认 600（10 分钟——比 approval 的 5 分钟长，因为打字比点确认慢）；
4. `askGate` 缺失时返回 "asking is unavailable" 文本（防御，正常接线恒存在）；
5. `await askGate.ask(...)`，catch rejection（abort/`rejectAll`）返回 aborted 文本结果；
6. 结果：
   - 已答：`content = [{ type:"text", text: "User's answer:\n" + answer }]`，`details = { cardType: "question", question, options?, answer }`；
   - 超时：`content = "User did not answer within N minutes. Continue with your best judgment; do not call ask_user again for this question in this run."`，`details = { cardType: "question", question, options?, timedOut: true }`。

**工具描述（给 LLM 的使用约束，写进 description）**：仅在「真正被阻塞、只有用户能提供、自行假设明显更差」时使用；确认类场景直接执行；能自己用工具查到的不要问；后台/自动化运行不要问；用户未回答时按最佳判断继续而非重复发问。

**ToolContext** — `src/tools/tool-context.ts`：构造函数新增 `askGate?: AskGate` 参数 + getter（照 `approvalGate` 镜像）。

**接线** — `src/session/live-session.ts`：`buildAgent` 新增 `askGate` 参数（`createAskGate(controlBus)` 与 `createApprovalGate(controlBus)` 并列创建传入），`buildPromptAndTools` 转入 `ToolContext`。controlBus 在 `create/restore` 恒建，故 askGate 恒可用。

**注册** — `src/tools/index.ts`：`BUILTIN_TOOL_NAMES` 增加 `"ask_user"`（同时让 `manage_agent` 的工具名校验自动接受）；`createToolsForProject` 增加 `ask_user: createAskUserTool(ctx.askGate)`。**不经 `withApproval` 包装**。

### 5.2 Server（`packages/server`）

**contracts** — `src/contracts/websocket.ts`：

- `chatServerEvent` union 增加 question 的 `control_request` / `control_resolved` 两个变体（与 core `SessionControlEvent` 镜像，`EventOf<>` 推导保持）；
- `chatClientMessage` 的 `resolve_control_request` 改为按 `kind` 判别联合：
  - `kind: "approval"`：`{ requestId, kind, approved, reason? }`（不变）
  - `kind: "question"`：`{ requestId, kind, answer: Type.String() }`

**ws-chat.ts** — `resolve_control_request` handler 按 `msg.kind` 分支构造 decision：question → `{ answer: msg.answer, timedOut: false }`；approval 路径不变。

**ChatSessionHub** — 零改动（payload 透传；`runEvents` 重放让晚打开的会话页直接看到待答问题并可回答，requestId 仍指向活跃 bus）。

### 5.3 App（`packages/app`）

**类型** — `features/chat/types.ts`：

```ts
export interface QuestionCard {
  type: "question";
  status: "pending" | "answered" | "timeout";
  question: string;
  options?: string[];
  answer?: string;
  requestId?: string;   // 保持「pending ⟺ requestId 真值」全chat不变量
}
```

`ChatCard` union 增加 `"question"`。

**reducer** — `features/chat/model/chat-session-reducer.ts`：

- `control_request && kind === "question"`：在匹配 toolCall（`toolCallId === event.toolCallId`，最后一条 assistant 消息）上挂 `{ type:"question", status:"pending", question: args.question, options: args.options, requestId }`（args 读取做 `typeof` 防御，同 command 卡模式）；
- `control_resolved && kind === "question"`：按 `requestId` 匹配卡片，`event.timedOut ? status:"timeout" : status:"answered" + answer`，`requestId: undefined`。

**渲染** — 新组件 `features/chat/QuestionCard.tsx`：

- pending：问题文本（`whitespace-pre-wrap`，非 Markdown）；有 options 则渲染候选按钮组（点击即以该选项文本为答案发送）；常驻文本输入（Input，maxLength 2000，Enter 或发送按钮提交，placeholder i18n；trim 后为空不可提交，发送按钮禁用）；提交/点选后输入区与按钮组整体禁用；
- answered：紧凑展示「你的回答」+ 答案文本；
- timeout：展示「未回答（等待超时）」；
- 样式遵循语义 token（`bg-card` / `border-border` / `text-foreground` 等），逻辑属性（`ps-*`），无 data 钩子（与 CommandCard/ApprovalCard 一致，卡片层无钩子约定）。

**props 链**：`Chat`（`handleRespondQuestion`，含 WS 未连通 toast，镜像 `approvalNotDelivered`）→ `MessageList` → `MessageItem`（dispatch 增加 question 分支）→ `QuestionCardRenderer`。

**runtime / store**：

- `chat-session-runtime.ts`：`respondQuestion(requestId, answer)` 发送 `{ type: "resolve_control_request", requestId, kind: "question", answer }`，`isOpen` 守卫返回 boolean；
- `streaming-store.ts`：`respondQuestion(sessionId, requestId, answer)` action（镜像 `respondApproval`）。

**历史重建** — `features/chat/model/chat-tool-projection.ts` `buildCardFromToolResult` 增加 `ask_user` 分支：`details.cardType === "question"` → 按 `answer` / `timedOut` 构造 answered/timeout 卡。`extractCardFromPartial` 不涉及（ask 无 onUpdate 流式）。

**跨会话通知** — `features/chat/model/approval-notice.ts` `collectPendingApprovals` 泛化：`_card.type === "question"` 且 `requestId` 真值计入，返回项携带 kind；`ApprovalNoticeBridge` 对 question 用新 i18n key 弹 toast（「正在等待你的回答」），跳转逻辑复用。

**agent 对话框** — `features/agent-dialog/tool-registry.ts` 新增非 advanced 组：`{ label: "tool.ask_user", hint: "tool.ask_user_hint", toolIds: ["ask_user"] }`。

### 5.4 Presets 与 i18n

- `packages/presets/templates/agent-template.md`：tools 列表加 `ask_user`（新建 agent 默认启用；已存在 agent 不受影响）；改后跑 `npm run build --workspace=packages/presets` 同步。
- `packages/i18n/src/locales/zh-CN.ts` 基准新增（带场景注释）：`tool.ask_user` / `tool.ask_user_hint`（agent 对话框工具组）、`chat.questionInputPlaceholder` / `chat.questionSend` / `chat.questionAnswerLabel` / `chat.questionTimeoutLabel`（问题卡）、`chat.questionNotDelivered`（WS 断开 toast）、`chat.questionToastMessageWithName`（跨会话通知，沿用 `「{name}」` 包裹约定，保留无法解析 agent 名时的泛化兜底 key）。`zh-TW` / `en` 同步翻译。

### 5.5 i18n / 主题契约影响

无新增 `data-chat-*` / `data-md-*` 钩子，无 CSS token 变更 → 不触发 `create-ui-theme` / `create-agent-chat-theme` skill 文档同步。

## 6. 关键决策记录（需求对齐）

| # | 问题 | 决定 | 理由（含被否选项） |
|---|---|---|---|
| D1 | 工具命名 | `ask_user`（kind 用 `"question"`） | 动词+宾语与 `run_command`/`emit_trigger_event` 一致，自文档化；`ask` 太泛、`question` 是名词 |
| D2 | 参数形态 | `{ question, options?(2-6), timeout_s? }`，单选 + 永远允许自由文本 | 覆盖绝大多数场景；多选/结构化答案 YAGNI |
| D3 | 回传通道 | `SessionControlBus` 第二 kind | 见 §3 方案对比；架构预留点 |
| D4 | 超时策略 | 默认 600s，LLM 可调 60–3600s，超时 resolve `{timedOut:true}` 并在 tool result 中劝阻重复发问 | 打字比点确认慢，取 approval 5min 的两档；必须有界（headless run 挂死风险）；无超时（选项 C）被否 |
| D5 | yolo 交互 | ask 不受 yolo 影响，恒等待 | yolo 语义是「危险动作免审批」，问题无法被自动代答，二者正交 |
| D6 | headless（trigger）行为 | 超时兜底（control 事件被 trigger sink 丢弃，等同 approval 现状） | 与既有行为一致；通知推送列为 future work |
| D7 | 默认启用 | 新 agent 模板默认含 `ask_user`；存量 agent 不变 | 非危险工具遵循「默认勾选全部普通工具」现状；工具 description + 超时文案约束滥用 |
| D8 | 答案在 UI 的呈现 | 答案只存在于 tool result + QuestionCard 已答态，不生成独立 user message | 保持消息流纯净；模型经 tool result 获得答案已足够 |
| D9 | 并发多 ask | 允许（bus 天然支持多 pending，各卡独立 requestId） | 不额外设限；模型极少并行提问 |
| D10 | abort 语义 | `rejectAll` → execute catch → 返回 aborted 文本结果（不 throw） | 与 run_command 一致的「编码错误而非异常」风格；run 已终止，结果仅落历史 |

## 7. 行为边界与异常场景

1. **run 活跃时用户普通消息**：hub 单飞保护拒绝（session busy）——问题卡是唯一应答通道，这是本设计的直接动机（§1）。
2. **断线重连**：`ChatSessionRuntime` 的 `connectionEvents` 缓冲 + 重放对账已覆盖 control 事件；重连后 pending 卡仍在，`requestId` 不变可正常作答。
3. **晚进入会话页**：hub `attach()` 重放 `runEvents`，待答问题卡直接出现且可回答。
4. **应用重启**：run 丢失（与 approval 现状一致），无 pending 态持久化；历史仅保留最终 toolResult（answered/timeout 卡可重建）。
5. **超时后用户再答**：`bus.resolve` 对未知 requestId 静默忽略，UI 已收敛为 timeout 态。
6. **agent 配置热重载**：`tools` 列表变化下一轮生效，与现有 `applyReload` 语义一致，无特判。
7. **abort/run 结束时 pending 卡收敛**：`rejectAll` 不发 `control_resolved`，reducer 在 `run_status inactive` 时清除最后一条 assistant 消息上仍处 pending（requestId 真值）的 QuestionCard——该 tool call 由折叠行展示 aborted 文本结果，与重启后历史重建（aborted details 不产卡）一致；answered/timeout 终态卡不受影响，approval 卡的同类残留为既有行为、另立 follow-up。

## 8. 测试计划

**core（`npm test --workspace=packages/core`）**

- `control-bus.test.ts` 扩展：question kind 的 request/resolve/timeout（fallback decision）/rejectAll/事件形状（`control_resolved` 携带 `answer`/`timedOut`）。
- 新 `ask-user.test.ts`（fake AskGate）：正常回答、超时、abort、gate 缺失降级、`timeout_s` clamp 边界（60/3600/默认 600）、options 清洗（<2 降级为自由文本）、toolResult content 与 details 断言。
- `tools/index` 注册测试：`ask_user` 在 `BUILTIN_TOOL_NAMES` 且 `createToolsForProject` 产出。
- `live-session.test.ts` 扩展：ask gate 接线（buildAgent → ToolContext 传递）+ `resolveControlRequest` 对 question decision 的路由。

**server（`npm test --workspace=packages/server`）**

- contract 解析测试：question 变体的 `control_request`/`control_resolved` 合法负载；`resolve_control_request` 两 kind 判别（approval 带 approved、question 带 answer，缺失字段拒绝）。

**app（`npm test --workspace=packages/app`）**

- reducer：question 卡 pending 挂载（含 args 防御）、resolved（answered/timeout）、requestId 不变量。
- `chat-tool-projection`：`buildCardFromToolResult` 的 `ask_user` 历史重建。
- `approval-notice`：question 卡计入 pending 通知。
- `QuestionCard` 组件：三态渲染 + options 点击/文本提交回调 + 禁用态。

**i18n**：三语 key 齐全（`npm test --workspace=packages/i18n` / verify 的 i18n check）。

**E2E**：不新增 spec（模拟模型主动发起 ask 需真实 LLM）；按 AGENTS.md 规则，改动涉及 chat/session 链路 → 回归现有 chat 相关 E2E（如 `npm run test:e2e --workspace=packages/desktop -- e2e/chat*.spec.ts` 中受影响者）；开发期手动验证完整往返。

## 9. 文档同步清单（实现完成后）

- [x] `docs/official/architecture.md`：§工具集合加入 `ask_user`；§运行时控制请求更新为两种 kind 并描述 question 往返。
- [x] `docs/official/project-structure.md`：`tools/ask-user.ts`、`session/ask-gate.ts` 条目。
- [x] `docs/dev/backlog.md`：新增条目并按完成状态打勾、链接本 feature 目录。
- [x] `packages/presets/templates/agent-template.md`：+ `ask_user`（触发同步构建）。

## 10. Future work（记录，不在本期内）

- headless run（trigger/定时）的待答通知：control 事件无订阅者时经 `/ws` bus 发一条可跳转的通知事件（复用 trigger notify 模式）。
- steering kind：运行中用户主动追加指令/纠偏（第三 kind）。
- 多选 options 与答案 schema 校验（若真实需求出现）。
- `ask_user` 在 UI SDK / HtmlCard 场景的等价物（HTML 卡内向「当前会话」提问）。
