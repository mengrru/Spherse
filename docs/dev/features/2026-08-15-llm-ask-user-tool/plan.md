# Implementation Plan: LLM ask/question 工具（`ask_user`）

- 日期：2026-08-15
- Design：`docs/dev/features/2026-08-15-llm-ask-user-tool/design.md`（本计划不重复 rationale，只写 what/how/verify）
- 模式：subagent-driven，每个 Task 独立可验证、按依赖顺序执行

## 任务依赖图

```
T1 core bus/types ──► T2 core tool/wiring ──► T3 server contract/routing
                                                  │
T4 i18n keys ─────────────────────────────────────►├──► T5 app types/reducer/runtime
                                                   │        │
                                                   │        ▼
                                                   │    T6 app QuestionCard UI
                                                   │        │
                                                   └──► T7 app projection/toast
                                                            │
T8 presets/docs ◄───────────────────────────────────────────┤
                                                            ▼
                                                     T9 verify 全量
```

T4（i18n）只被 T6/T7 依赖；T8 可在 T2 后任意时点插入。

## 共享类型契约（各 Task 以此为准，勿自行变形）

```ts
// core/src/session/types.ts
export type ControlRequestKind = "approval" | "question";
// SessionControlEvent 新增两个变体：
| { type: "control_request"; requestId: string; kind: "question";
    toolCallId: string; toolName: string; args: unknown }
| { type: "control_resolved"; requestId: string; kind: "question";
    answer?: string; timedOut: boolean }

// core/src/tools/ask-user.ts
export interface AskOutcome { answer?: string; timedOut: boolean }
export interface AskGate {
  ask(req: { requestId: string; toolCallId: string; toolName: string; args: unknown },
      timeoutMs: number): Promise<AskOutcome>;
}

// app features/chat/types.ts
export interface QuestionCard {
  type: "question";
  status: "pending" | "answered" | "timeout";
  question: string;
  options?: string[];
  answer?: string;
  requestId?: string; // 不变量：pending ⟺ requestId 真值
}
```

WS 回传消息（client→server）：`{ type: "resolve_control_request", requestId, kind: "question", answer: string }`。

---

## Task 1: Core — control bus 支持 `"question"` kind

**依赖**：无。

**改动文件**：
- `packages/core/src/session/types.ts`：`ControlRequestKind` 加 `"question"`；`SessionControlEvent` 加上述两个 question 变体（approval 变体不变）。
- `packages/core/src/session/control-bus.ts`：`emitResolved` 由 `if (kind === "approval")` 改为按 kind switch；`"question"` 分支发射 `{ type: "control_resolved", requestId, kind, answer, timedOut }`（decision cast 为 `AskOutcome` 形状，类型定义在 control-bus 内联 or 从 tools/ask-user.ts import——注意此时 ask-user.ts 尚未创建，**本 task 内联 `{ answer?: string; timedOut: boolean }` 形状即可**，T2 建文件后统一引用）。`request/resolve/rejectAll` 零改动。

**测试**（扩展 `packages/core/src/__tests__/session/control-bus.test.ts`）：
- question kind：request 发射事件形状；resolve 携带 `{ answer, timedOut: false }` 时 `control_resolved` 含 answer；
- timeout fallback：`request(..., timeoutMs, { timedOut: true })` 超时后 resolve 值为 fallback、事件 `timedOut: true` 无 answer；
- rejectAll 依旧 reject；
- approval 既有用例不回归。

**验证**：`npm test --workspace=packages/core`

---

## Task 2: Core — `ask_user` 工具 + AskGate + 全链接线

**依赖**：T1。

**改动文件**：
- 新 `packages/core/src/tools/ask-user.ts`：
  - 导出 `AskGate` / `AskOutcome`（见共享契约）；
  - `AskUserParams = Type.Object({ question: Type.String({...}), options: Type.Optional(Type.Array(Type.String(), { minItems: 2, maxItems: 6, ... })), timeout_s: Type.Optional(Type.Number({...})) })`，参数 description 按 design §5.1；
  - `createAskUserTool(askGate?: AskGate): AgentTool<typeof AskUserParams, AskUserDetails>`，`AskUserDetails = { cardType: "question"; question: string; options?: string[]; answer?: string; timedOut?: boolean }`；
  - execute 顺序：① `signal?.aborted` → 返回 aborted 文本结果；② 清洗 options（非字符串剔除，清洗后 <2 视为无 options）；③ clamp `timeout_s` 至 [60, 3600]，默认 600；④ 无 askGate → "asking is unavailable" 文本；⑤ `await askGate.ask(...)` catch → aborted 文本结果；⑥ 已答 → `content: "User's answer:\n" + answer` + details `{ cardType:"question", question, options?, answer }`；超时 → `content: "User did not answer within N minutes. Continue with your best judgment; do not call ask_user again for this question in this run."`（N 为实际分钟数）+ details `{ ..., timedOut: true }`；
  - **不 throw**，错误全部编码进结果（对齐 run_command 风格）；
  - tool description 含使用约束（design §5.1：仅真正被阻塞时用；确认类直接执行；可自查的不问；后台运行不问；超时后勿重复发问）；
  - `executionMode: "sequential"`。
- 新 `packages/core/src/session/ask-gate.ts`：`createAskGate(bus: SessionControlBus): AskGate`，内部 `bus.request<AskOutcome>({ kind: "question", ... }, timeoutMs, { timedOut: true })`（镜像 `approval-gate.ts`；超时常量不在此文件——timeout 由 tool 传入）。
- `packages/core/src/tools/tool-context.ts`：构造函数追加末位参数 `askGate?: AskGate` + `get askGate()`（镜像 approvalGate）。
- `packages/core/src/tools/index.ts`：`BUILTIN_TOOL_NAMES` 加 `"ask_user"`；`createToolsForProject` 加 `ask_user: createAskUserTool(ctx.askGate)`。**不包 withApproval**。
- `packages/core/src/session/live-session.ts`：`buildAgent` 签名追加 `askGate` 参数；`create`/`restore` 处与 `createApprovalGate(controlBus)` 并列传入 `createAskGate(controlBus)`；`buildPromptAndTools` 构造 `ToolContext` 时透传。
- `packages/core/src/index.ts`（barrel）：检查是否需导出新符号——仅当外部（server/app）实际消费才导出；AskGate/AskOutcome 预计仅 core 内部使用，默认不导出。

**测试**：
- 新 `packages/core/src/__tests__/tools/ask-user.test.ts`（fake AskGate）：正常回答（content 前缀 + details.answer）、超时（content 含 "did not answer" + timedOut）、abort（signal 预先 aborted + gate reject 两条路径）、gate 缺失、clamp 边界（59→60、3601→3600、缺省 600）、options 清洗（`["a", 123, null]` → `["a"]` → 无 options）、options 恰 2 个保留；
- 扩展 `packages/core/src/__tests__/session/live-session.test.ts`：buildAgent→ToolContext askGate 传递（可用 spy gate 断言被调）；
- 扩展 `packages/core/src/__tests__/tools/tools-integration.test.ts`：`ask_user` 在 `BUILTIN_TOOL_NAMES` 与 `createToolsForProject` 产出中。

**验证**：`npm test --workspace=packages/core`

---

## Task 3: Server — contract 判别联合 + ws 路由 + hub 类型放宽

**依赖**：T2（需要 core 的 SessionControlEvent 新变体）。

**改动文件**：
- `packages/server/src/contracts/websocket.ts`：
  - `chatServerEvent` union 追加 question 的 `control_request` / `control_resolved` 两个变体（字段见共享契约；`args` 沿用 `Type.Unsafe<...>(Type.Unknown())` 模式——注意 `EventOf<SessionControlEvent, "control_request">` 现在匹配两个成员，若索引 `["args"]` 因联合退化报错，改为 `Extract<>` 或直接 `Type.Unknown()`）；
  - `chatClientMessage` 的 `resolve_control_request` 改为按 kind 判别联合：approval 变体（不变）+ question 变体 `{ type, requestId, kind: Type.Literal("question"), answer: Type.String() }`。
- `packages/server/src/ws-chat.ts`：`resolve_control_request` handler 按 `msg.kind` 分支——`"question"` → `attachment.resolveControlRequest(msg.requestId, { answer: msg.answer, timedOut: false })`；`"approval"` 路径原样。
- `packages/server/src/chat-session-hub.ts`：`ChatSessionAttachment.resolveControlRequest` 的 decision 参数类型放宽为 approval/question 联合（payload 透传，逻辑零改动）。

**测试**：
- 新 `packages/server/src/__tests__/contracts/chat-websocket-contracts.test.ts`（对齐既有 `contracts/api-contracts.test.ts` / `contracts/bus-contracts.test.ts` 模式）：question 两个 server event 变体合法负载 parse 通过；`resolve_control_request` question 缺 `answer` 拒绝、approval 缺 `approved` 拒绝、两 kind 各自合法负载通过；
- 扩展 `packages/server/src/__tests__/ws-chat.test.ts`：`resolve_control_request` 按 kind 分支构造 decision 的路由断言；
- approval 既有用例不回归。

**验证**：`npm test --workspace=packages/server && npm run build --workspace=packages/server`

---

## Task 4: i18n — 三语 key

**依赖**：无（可与 T1-T3 并行）。

**改动文件**：`packages/i18n/src/locales/zh-CN.ts`（基准+场景注释）、`zh-TW.ts`、`en.ts`。

**新增 key**（命名对齐既有 `chat.approvalToastMessage` / `tool.run_command` 惯例）：

| key | 场景 |
|---|---|
| `tool.ask_user` | agent 对话框工具组名（「向用户提问」） |
| `tool.ask_user_hint` | 工具组说明（运行中向用户提问并等待回答） |
| `chat.questionInputPlaceholder` | QuestionCard 待答态输入框 placeholder |
| `chat.questionSend` | QuestionCard 发送按钮 |
| `chat.questionAnswerLabel` | QuestionCard 已答态「你的回答」标签 |
| `chat.questionTimeoutLabel` | QuestionCard 超时态「未回答（等待超时）」 |
| `chat.questionNotDelivered` | WS 断开时回答未送达 toast（镜像 `chat.approvalNotDelivered`） |
| `chat.questionToastMessage` | 跨会话通知兜底（无法解析 agent 名） |
| `chat.questionToastMessageWithName` | 跨会话通知（`{name}` 占位，沿用 `「{name}」` 包裹约定） |

**验证**：`npm test --workspace=packages/i18n`（缺 key 会被 i18n check 抓）

---

## Task 5: App — QuestionCard 类型 + reducer + runtime/store 链路

**依赖**：T3（parse 后的事件类型含 question 变体）。

**改动文件**：
- `packages/app/src/features/chat/types.ts`：`QuestionCard`（见共享契约）+ `ChatCard` union 加 `"question"`。
- `packages/app/src/features/chat/model/agent-event-parse.ts`：`parseAgentEvent` 的 `control_resolved` 分支现在硬编码 `approved/reason`——按 `event.kind` 分支：question → 透传 `{ answer, timedOut }`，approval → 原样；`control_request` 分支字段两 kind 同形，`kind` 透传即可（无逻辑改动，仅类型联合自然扩散）。
- `packages/app/src/features/chat/model/chat-session-reducer.ts`：
  - `control_request && kind === "question"`：`updateLastToolCall` 匹配 `toolCallId`，挂 `_card = { type:"question", status:"pending", question: typeof args.question === "string" ? ... : "", options: Array.isArray(args.options) ? args.options.filter(s => typeof s === "string") : undefined, requestId }`（防御读取，同 command 卡模式；清洗后 <2 个则 options 置 undefined）；
  - `control_resolved && kind === "question"`：按 `tc._card?.type === "question" && tc._card.requestId === event.requestId` 匹配 → `event.timedOut ? { status:"timeout", requestId: undefined } : { status:"answered", answer: event.answer, requestId: undefined }`。
- `packages/app/src/features/chat/runtime/chat-session-runtime.ts`：`respondQuestion(requestId: string, answer: string): boolean`——`isOpen()` 守卫，发送 `{ type: "resolve_control_request", requestId, kind: "question", answer }`，返回送达与否（镜像 `respondApproval`）。
- `packages/app/src/features/chat/runtime/streaming-store.ts`：action `respondQuestion(sessionId, requestId, answer): boolean`（镜像 `respondApproval`）。

**测试**（扩展 `packages/app/src/features/chat/model/agent-event-parse.test.ts` + `chat-session-reducer.test.ts`）：
- parse：question control_request/resolved 事件字段完整透传（answer/timedOut 不丢）；
- reducer：question control_request 挂卡（含 args 非法防御、options 清洗）；
- resolved answered / timeout 两态 + `requestId` 清空（pending⟺requestId 不变量）；
- approval 既有用例不回归。

**验证**：`npm test --workspace=packages/app`

---

## Task 6: App — QuestionCard 组件 + props 链

**依赖**：T4（i18n key）、T5（respondQuestion action）。

**改动文件**：
- 新 `packages/app/src/features/chat/QuestionCard.tsx`：
  - props：`card: QuestionCard` + `onRespondQuestion?: (requestId: string, answer: string) => void`（仅 pending 态使用）；
  - pending 态：问题文本（`whitespace-pre-wrap`，非 Markdown）；options 按钮组（点击即发送该选项文本）；文本输入（受控 Input，maxLength 2000，trim 为空则发送按钮禁用；Enter 提交——注意 IME：复用 Composer 的 `isComposing` 守卫模式）；提交/点选后禁用输入区与按钮组；
  - answered 态：`chat.questionAnswerLabel` + 答案文本；timeout 态：`chat.questionTimeoutLabel`；
  - 样式：语义 token（`bg-card`/`border-border`/`text-foreground`/`text-muted-foreground`/`bg-primary`）、逻辑属性（`ps-*`/`ms-*`）、无 data 钩子、无 `dark:`、组件 <150 行（超了抽子组件）；
  - 发送后本地立即置禁用（乐观），以 `control_resolved` 事件为准收敛终态。
- `packages/app/src/features/chat/MessageItem.tsx`：`card.type` dispatch 加 question 分支 → `QuestionCardRenderer`，透传 `onRespondQuestion`。
- `packages/app/src/features/chat/MessageList.tsx`：props 链透传。
- `packages/app/src/features/chat/index.tsx`：`handleRespondQuestion`——`respondQuestion` 返回 false 时 toast `chat.questionNotDelivered`（镜像 approval 路径）。

**测试**：新 `QuestionCard.test.tsx`——三态渲染、options 点击触发回调、空输入不可提交（按钮 disabled）、输入+Enter/按钮提交触发回调、answered 后无输入区。

**验证**：`npm test --workspace=packages/app`

---

## Task 7: App — 历史重建 + 跨会话通知

**依赖**：T5（QuestionCard 类型）、T4（i18n）。

**改动文件**：
- `packages/app/src/features/chat/model/chat-tool-projection.ts`：`buildCardFromToolResult` 加 `ask_user` 分支——`details.cardType === "question"` 时按 `details.answer` / `details.timedOut` 构造 answered/timeout 卡（无 requestId——历史卡恒非 pending）；`extractCardFromPartial` 与 `commandCardFromResult` 不动（ask 无流式 update）。
- `packages/app/src/features/chat/model/approval-notice.ts`：`collectPendingApprovals` 泛化——`_card.type === "question" && card.requestId` 计入，返回项携带 `kind: "approval" | "question"`（既有调用处类型同步）。
- `packages/app/src/features/chat/ApprovalNoticeBridge.tsx`：按 `kind` 选 i18n——question 用 `chat.questionToastMessageWithName` / `chat.questionToastMessage` 兜底，跳转与去重逻辑复用。

**测试**：
- projection：`ask_user` details→answered 卡 / timedOut 卡；无 question details 不产卡；
- approval-notice：question pending 卡计入、kind 正确、非 pending（answered/timeout）不计入；approval 既有用例不回归。

**验证**：`npm test --workspace=packages/app`

---

## Task 8: Presets 模板 + docs 同步

**依赖**：T2（工具名确定）。

**改动文件**：
- `packages/presets/templates/agent-template.md`：tools 列表加 `- ask_user`（放 `emit_trigger_event` 后）；改后执行同步构建（见验证）。
- `docs/official/architecture.md`：§「工具集合」加 `ask_user`（普通工具，非 withApproval 包装）；§「运行时控制请求」更新为两种 kind、补 question 往返与超时（默认 600s，clamp 60–3600）描述。
- `docs/official/project-structure.md`：`tools/ask-user.ts`、`session/ask-gate.ts` 条目。
- `docs/dev/backlog.md`：功能增强区新增条目（`[x]` + 一句话摘要 + 链接本 feature 目录）。

**验证**：`npm run build --workspace=packages/presets`（确认生成内容含 ask_user）

---

## Task 9: 全量验证

**依赖**：全部。

**步骤**：
1. `npm run build`（全 workspace 编译通过——重点确认 contracts 判别联合无类型退化）；
2. `npm run verify`（lint + build + unit tests + i18n check）；
3. 回归 E2E（改动涉 chat/session 链路，按 AGENTS.md 选择性回归）：`npm run test:e2e --workspace=packages/desktop -- e2e/chat-retry.spec.ts` 与 `e2e/chat-streaming-resilience.spec.ts`；
4. 手动冒烟（可选，需真实 LLM）：建 agent 勾选 ask_user → 对话诱导提问 → 回答/超时/切换会话再回/断线重连四路径。

**完成标准**：以上 1、2 全绿；3 无新增失败；design doc §9 清单全部勾掉。

---

## Subagent 执行注意

- 每个 Task 开工前先 `git log --oneline -3` + 读本计划对应节 + design doc 对应 §，**不要**重新探索全仓库；
- 严格遵守共享契约节的类型形状；发现契约与现实冲突时停下报告，勿自行变形；
- 不添加注释（AGENTS.md）；不 commit（等用户明确要求）；
- T1-T3 完成后 core/server 的 `npm run build` 必须过，再进 app 层；
- 测试文件遵循各 package 既有测试组织方式（`__tests__/` 目录、`*.test.ts` 命名）。
